import * as http from "node:http";
import {Trie, type TrieOptions} from "route-trie";
import type {IncomingMessage, ServerResponse} from "node:http";
import {type Chain, createChain} from "./chain.js";

export type AnyServerOptions = {
    routeTrie?: TrieOptions
};

export type HttpRequest = IncomingMessage & {params: Record<string, string>};
export type HttpChain<Acc extends object> = Chain<Acc, {request: HttpRequest, response: ServerResponse}>;

export class HttpRouteConstructor<Acc extends object = {}> {
    private chain: HttpChain<Acc>;
    private newConstructor: HttpRouteConstructor<Acc> | undefined;

    constructor(chain?: HttpChain<Acc>) {
        if (chain) this.chain = chain;
        else this.chain = createChain();
    }

    public add<R extends object>(handler: (request: HttpRequest, response: ServerResponse, prev: Acc) => Promise<R | void> | R | void): HttpRouteConstructor<Acc> {
        if (this.newConstructor) return this.newConstructor.add(handler);
        let newConstructor = new HttpRouteConstructor(this.chain.add(
            async (prev, {request, response}): Promise<R> => {
                return (await handler(request, response, prev)) ?? ({} as R);
            }
        ));
        this.newConstructor = newConstructor;
        return newConstructor;
    }

    public async run(request: HttpRequest, response: ServerResponse): Promise<void> {
        if (this.newConstructor) return this.newConstructor.run(request, response);
        await this.chain.run({request, response});
    }
}

type RawHttpHandler = (request: IncomingMessage, response: ServerResponse, params: Record<string, string>) => Promise<void>;

export class AnyServer {
    private trie: Trie;

    constructor(options: AnyServerOptions = {}) {
        this.trie = new Trie(options.routeTrie);
    }

    http(route: string, method: string) {
        let routeConstructor = new HttpRouteConstructor();
        let node = this.trie.define(route);
        node.handle(method.toUpperCase(), async (request: IncomingMessage, response: ServerResponse, params: Record<string, string>) => {
            let req: HttpRequest = request as HttpRequest;
            req.params = params;
            await routeConstructor.run(req, response);
        });
        return routeConstructor;
    }

    listen(port: number = 8080, host: string = "0.0.0.0", listeningListener?: () => void) {
        return http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
            let matched = this.trie.match(request.url ?? "/");
            let handler: RawHttpHandler | undefined = matched.node?.getHandler(request.method?.toUpperCase() ?? "GET");
            if (!handler) return;
            await handler(request, response, matched.params);
        }).listen(port, host, listeningListener);
    }
}

const app = new AnyServer();

// app.http("/test/:id", "GET")
//     .add((request, response) => {
//         console.log(request.method, request.url, request.params);
//         response.write(`${request.method} ${request.url}`)
//         response.end();
//     });

app.http("/:test*", "GET")
    .add((request, response) => {
        console.log(request.method, request.url, request.params);
        response.write(`${request.method} ${request.url}`)
        response.end();
    });

app.listen();
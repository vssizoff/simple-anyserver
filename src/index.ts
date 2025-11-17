import * as http from "node:http";
import type {IncomingMessage, ServerResponse} from "node:http";
import {type Chain, createChain} from "./chain.js";
import {RouteTrie, RouteTrieOptions} from "./trie";

export type AnyServerOptions = {
    routeTrie?: RouteTrieOptions;
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

    public add<R extends object | void>(handler: (request: HttpRequest, response: ServerResponse, prev: Acc) => Promise<R> | R): HttpRouteConstructor<Acc> {
        if (this.newConstructor) return this.newConstructor.add(handler);
        let newConstructor = new HttpRouteConstructor(this.chain.add<R>(
            async (prev, {request, response}): Promise<R> => {
                return handler(request, response, prev);
            }
        ));
        this.newConstructor = newConstructor;
        return newConstructor;
    }

    public async run(request: HttpRequest, response: ServerResponse): Promise<boolean> {
        if (this.newConstructor) return this.newConstructor.run(request, response);
        return this.chain.run({request, response});
    }
}

export class AnyServer {
    private trie: RouteTrie;

    constructor(options: AnyServerOptions = {}) {
        this.trie = new RouteTrie(options.routeTrie);
    }

    http(route: string, method?: string) {
        let routeConstructor = new HttpRouteConstructor();
        this.trie.addRoute(route, async (request: IncomingMessage, response: ServerResponse, params: Record<string, string>) => {
            if (method && request.method?.toUpperCase() != method.toUpperCase()) return;
            let req: HttpRequest = request as HttpRequest;
            req.params = params;
            return routeConstructor.run(req, response);
        });
        return routeConstructor;
    }

    listen(port: number = 8080, host: string = "0.0.0.0", listeningListener?: () => void) {
        return http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
            let matched = this.trie.match(request.url ?? "/");
            for (let match of matched) {
                for (let handler of match.handlers) {
                    let next = await handler(request, response, match.params) as boolean;
                    if (!next) return;
                }
            }
        }).listen(port, host, listeningListener);
    }
}

const app = new AnyServer();

app.http("/test/:id", "GET")
    .add((request, response) => {
        console.log(request.method, request.url, request.params);
        response.write(`${request.method} ${request.url}`)
        response.end();
    });

// app.http("/:test*", "GET")
//     .add((request, response) => {
//         console.log(request.method, request.url, request.params);
//         response.write(`${request.method} ${request.url}`)
//         response.end();
//     });

app.http("/*")
    .add((request, response) => {
        response.statusCode = 404;
        response.end("404 Not Found");
    });

app.listen();
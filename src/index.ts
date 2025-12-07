import * as http from "node:http";
import type {IncomingMessage, ServerResponse} from "node:http";
import {type Chain, createChain} from "./chain.js";
import {RouteTrie, RouteTrieOptions} from "./trie.js";
import { WebSocketServer } from 'ws';

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

export type WSChain<Acc extends object> = Chain<Acc, {ws: WebSocket, request: HttpRequest}>;

export class WSRouteConstructor<Acc extends object = {}> {
    private chain: WSChain<Acc>;
    private newConstructor: WSRouteConstructor<Acc> | undefined;

    constructor(chain?: WSChain<Acc>) {
        if (chain) this.chain = chain;
        else this.chain = createChain();
    }

    public add<R extends object | void>(handler: (ws: WebSocket, request: HttpRequest, prev: Acc) => Promise<R> | R): WSRouteConstructor<Acc> {
        if (this.newConstructor) return this.newConstructor.add(handler);
        let newConstructor = new WSRouteConstructor(this.chain.add<R>(
            async (prev, {ws, request}): Promise<R> => {
                return handler(ws, request, prev);
            }
        ));
        this.newConstructor = newConstructor;
        return newConstructor;
    }

    public async run(ws: WebSocket, request: HttpRequest): Promise<boolean> {
        if (this.newConstructor) return this.newConstructor.run(ws, request);
        return this.chain.run({ws, request});
    }
}

export class AnyServer {
    private trie: RouteTrie;
    private wsTrie: RouteTrie;
    private wss = new WebSocketServer({ noServer: true });

    constructor(options: AnyServerOptions = {}) {
        this.trie = new RouteTrie(options.routeTrie);
        this.wsTrie = new RouteTrie(options.routeTrie);
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

    ws(route: string) {
        let routeConstructor = new WSRouteConstructor();
        this.trie.addRoute(route, async (ws: WebSocket, request: IncomingMessage, params: Record<string, string>) => {
            let req: HttpRequest = request as HttpRequest;
            req.params = params;
            return routeConstructor.run(ws, req);
        });
        return routeConstructor;
    }

    listen(port: number = 8080, host: string = "0.0.0.0", listeningListener?: () => void) {
        const server = http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
            let matched = this.trie.match(request.url ?? "/");
            for (let match of matched) {
                for (let handler of match.handlers) {
                    let next = await handler(request, response, match.params) as boolean;
                    if (!next) return;
                }
            }
        });
        server.on("upgrade", (request, socket, head) => {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        });
        this.wss.on('connection', async (ws, request) => {
            let matched = this.trie.match(request.url ?? "/");
            for (let match of matched) {
                for (let handler of match.handlers) {
                    let next = await handler(ws, request, match.params) as boolean;
                    if (!next) return;
                }
            }
        });
        return server.listen(port, host, listeningListener);
    }
}

const app = new AnyServer();

app.http("/test/:id", "GET")
    .add((request, response) => {
        console.log(request.method, request.url, request.params);
        response.write(`${request.method} ${request.url}`)
        response.end();
    });

app.ws("/ws")
    .add((ws, request) => {
        ws.addEventListener("open", (event) => {console.log("open", event);});
        ws.addEventListener("close", (event) => {console.log("close", event);});
        ws.addEventListener("error", (event) => {console.log("error", event);});
        ws.addEventListener("message", (event) => {
            console.log("message", event);
            ws.send(JSON.stringify(event.data.toString()));
        });
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
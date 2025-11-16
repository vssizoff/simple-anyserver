import * as http from "node:http";

http.createServer(
    (request, response) => {
        console.log(request.method, request.url);
        response.write(`${request.method} ${request.url}`)
        response.end();
    }
).listen(8000);
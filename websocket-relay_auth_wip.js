// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

var fs = require('fs'),
    http = require('http'),
    https = require('https'),
    WebSocket = require('ws');

const options = {
    key: fs.readFileSync('certs/key.pem'),
    cert: fs.readFileSync('certs/cert.pem')
};

if (process.argv.length < 3) {
    console.log(
        'Usage: \n' +
        'node websocket-relay.js <secret> [<stream-port> <websocket-port>]'
    );
    process.exit();
}

var STREAM_SECRET = process.argv[2],
    STREAM_PORT = process.argv[3] || 8081,
    WEBSOCKET_PORT = process.argv[4] || 8082,
    // WEBSOCKET_HTTPS_PORT = process.argv[4] || 8083,
    RECORD_STREAM = false;

function toEvent(message) {
    try {
        var event = JSON.parse(message);
        this.emit(event.type, event.payload);
    } catch (err) {
        console.log('not an event', err);
    }
}

// Websocket https
const socketServerHttps = https.createServer(options);
socketServerHttps.listen(WEBSOCKET_PORT);

var ws_options = {
    noServer: true,
    perMessageDeflate: false,
    protocol: "protocol1",
    server: socketServerHttps
};

function validate(data) {
    // let user = "user";
    // let pass = "pass";
    let user = "shorti1996";
    let pass = "dupacycki";
    return (data.login && data.login === user) && (data.password && data.password === pass)
}

// Websocket Server
var socketServer = new WebSocket.Server(ws_options);
socketServer.connectionCount = 0;
var authenticatedClients = [];
var socketsPurgatory = [];
logAuthenticatedClientsCount = function () {
    console.log("Authenticated clients: " + authenticatedClients.length);
};
socketServer.on('connection', function (socket, upgradeReq, client) {
    socket.on('message', toEvent).on('authenticate', function (data) {
        console.log(`Received message ${JSON.stringify(data)} from user ${client}`);
        if (validate(data)) {
            console.log("client authenticated");
            socketsPurgatory = socketsPurgatory.filter(({timestamp, sock}) => sock !== socket);
            authenticatedClients.push(socket);
            logAuthenticatedClientsCount();
        } else {
            console.log("unable to authenticate the client");
            socket.close();
        }
        socketServer.broadcast(JSON.stringify({type: "lol", payload: {}}));
    });

    socketServer.connectionCount++;
    socketsPurgatory.push({timestamp: Date.now(), sock: socket});
    console.log(
        'New WebSocket Connection: ',
        (upgradeReq || socket.upgradeReq).socket.remoteAddress,
        (upgradeReq || socket.upgradeReq).headers['user-agent'],
        '(' + socketServer.connectionCount + ' total)'
    );
    socket.on('close', function (code, message) {
        authenticatedClients = authenticatedClients.filter((sock) => sock !== socket);
        socketServer.connectionCount--;
        console.log(
            'Disconnected WebSocket (' + socketServer.connectionCount + ' total)'
        );
        logAuthenticatedClientsCount();
    });
});
socketServer.broadcast = function (data) {
    // console.log("broadcast");
    // socketServer.clients.forEach(function each(client) {
    authenticatedClients.forEach(function each(client) {
        // console.log("broadcast for client");
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
var streamServer = http.createServer(function (request, response) {
    var params = request.url.substr(1).split('/');

    if (params[0] !== STREAM_SECRET) {
        console.log(
            'Failed Stream Connection: ' + request.socket.remoteAddress + ':' +
            request.socket.remotePort + ' - wrong secret.'
        );
        response.end();
    }

    response.connection.setTimeout(0);
    console.log(
        'Stream Connected: ' +
        request.socket.remoteAddress + ':' +
        request.socket.remotePort
    );
    request.on('data', function (data) {
        socketServer.broadcast(data);
        if (request.socket.recording) {
            request.socket.recording.write(data);
        }
    });
    request.on('end', function () {
        console.log('close');
        if (request.socket.recording) {
            request.socket.recording.close();
        }
    });

    // Record the stream to a local file?
    if (RECORD_STREAM) {
        var path = 'recordings/' + Date.now() + '.ts';
        request.socket.recording = fs.createWriteStream(path);
    }
}).listen(STREAM_PORT);

console.log('Listening for incomming MPEG-TS Stream on http://127.0.0.1:' + STREAM_PORT + '/<secret>');
console.log('Awaiting WebSocket connections on ws://127.0.0.1:' + WEBSOCKET_PORT + '/');

var watchdogUnauthenticated = () => new Promise((completed, timeouted) => {
    let purgatoryCooldownMs = 5000;
    let check = () => {
        // console.log("checking if any websockets should be closed");
        let now = Date.now();
        let toClose = socketsPurgatory.filter(({timestamp, sock}) => (now - timestamp) > purgatoryCooldownMs);
        toClose.forEach(({timestamp, sock}) => {
            console.log("disconnecting client that is unauthenticated for too long (" + (now - timestamp) + "ms)");
            sock.close();
        });
        socketsPurgatory = socketsPurgatory.filter((el) => !toClose.includes(el));
        setTimeout(check, 60000);
    };
    check();
});
(async () => {
    await watchdogUnauthenticated();
})();

socketServer.broadcast({type: "lol", payload: {}});

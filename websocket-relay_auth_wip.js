// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

var fs = require('fs'),
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
    RECORD_STREAM = false;

var ws_options = {
    port: WEBSOCKET_PORT,
    perMessageDeflate: false,
    protocol: "protocol1"
};

function toEvent(message) {
    try {
        var event = JSON.parse(message);
        this.emit(event.type, event.payload);
    } catch (err) {
        console.log('not an event', err);
    }
}

// Websocket Server
var socketServer = new WebSocket.Server(ws_options);
socketServer.connectionCount = 0;
var authenticatedClients = [];
socketServer.on('connection', function (socket, upgradeReq, client) {
    socket.on('message', toEvent).on('authenticate', function (data) {
        console.log(`Received message ${JSON.stringify(data)} from user ${client}`);
        authenticatedClients.push(socket);
        socketServer.broadcast(JSON.stringify({type: "lol", payload: {}}));
        // if (msg.type === "authenticate") {
        //     console.log("wants auth");
        // }
    });

    // socketServer.on('upgrade', function upgrade(request, socket, head) {
    //     console.log(`auth`);
    //     authenticate(request, (err, client) => {
    //         console.log(`auth`);
    //         if (err || !client) {
    //             socket.destroy();
    //             return;
    //         }
    //
    //         socketServer.handleUpgrade(request, socket, head, function done(ws) {
    //             ws.emit('connection', ws, request, client);
    //         });
    //     });
    // });

    socketServer.on('upgrade', function upgrade(request, socket, head) {
        authenticate(request, (err, client) => {
            if (err || !client) {
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, function done(ws) {
                wss.emit('connection', ws, request, client);
            });
        });
    });

    socketServer.connectionCount++;
    console.log(
        'New WebSocket Connection: ',
        (upgradeReq || socket.upgradeReq).socket.remoteAddress,
        (upgradeReq || socket.upgradeReq).headers['user-agent'],
        '(' + socketServer.connectionCount + ' total)'
    );
    socket.on('close', function (code, message) {
        socketServer.connectionCount--;
        console.log(
            'Disconnected WebSocket (' + socketServer.connectionCount + ' total)'
        );
    });
});
socketServer.broadcast = function (data) {
    authenticatedClients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
var streamServer = https.createServer(options, function (request, response) {
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

socketServer.broadcast({type: "lol", payload: {}});

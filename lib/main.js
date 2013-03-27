const L = require('logger');

require("sdk/timers").setTimeout(function() {
    L.log("STARTING SETUP");
    const Server = require("server").Server;
    const server = new Server();
    var transport;
    if (true) {
        // loopback
        const Transport = require("transport-loopback").LoopbackTransport;
        transport = new Transport(server);
        var harness = require("./client");
    } else {
        // network
        const HTTPTransport = require("transport-http").HTTPTransport;
        transport = new HTTPTransport("http://localhost:8081/api");
    }
    require("./client").setup(transport);
    L.log("SETUP DONE");
}, 1000);

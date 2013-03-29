const L = require('logger');

require("sdk/timers").setTimeout(function() {
    L.log("STARTING DEMO");
    const Server = require("server").Server;
    const server = new Server();
    var transport;
    if (false) {
        // loopback
        const Transport = require("transport-loopback").LoopbackTransport;
        transport = new Transport(server);
    } else {
        // network
        const HTTPTransport = require("transport-http").HTTPTransport;
        transport = new HTTPTransport("http://localhost:8081/api");
    }
    require("./harness").setup(transport);
}, 1000);

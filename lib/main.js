const L = require('logger');

require("sdk/timers").setTimeout(function() {
    L.log("STARTING SETUP");
    var harness = require("./harness2");
    harness.setup();
    L.log("SETUP DONE");
}, 1000);

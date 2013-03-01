
const pcrypto = require("./picl-crypto");
const VersionStore = require("versions").VersionStore;
const L = require("logger");


function Server() {
    this._vs = new VersionStore
}

Server.prototype.acceptCommand = function(command) {
};

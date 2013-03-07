
const pcrypto = require("./picl-crypto");
const sversions = require("server-versions");
const L = require("logger");


function Server() {
    this._vs = new sversions.VersionStore();
    this._cv = new sversions.CurrentVersion(this._vs);
    this._clients = {}; // maps client-id to verhash
}

Server.prototype.command_createNewVersion = function() {
};

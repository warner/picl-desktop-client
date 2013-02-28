
const sjcl = require("./sjcl");

function VerHash() {
    this._accumulator = "";
}

VerHash.prototype.update = function(data) {
    this._accumulator += data;
};
VerHash.prototype.hexdigest = function() {
    return "hash:"+this._accumulator;
};
exports.VerHash = VerHash;

const SIGNPREFIX = "encrypted:";

exports.signVerhash = function(key, seqnum, verhash) {
    var signable = JSON.stringify({seqnum: seqnum,
                                   verhash: verhash});
    return SIGNPREFIX+signable;
};
exports.verifyVerhash = function(key, signed) {
    if (typeof(signed) !== "string")
        throw new Error("signed value should be a string");
    if (signed.indexOf(SIGNPREFIX) !== 0)
        throw new Error("corrupt version");
    var signable = JSON.parse(signed.slice(SIGNPREFIX.length));
    return {seqnum: signable.seqnum,
            verhash: signable.verhash};
};

const PREFIX = "encrypted:";

exports.encryptKV = function(key, value) {
    return PREFIX+value;
};

exports.decryptKEV = function(key, encrypted) {
    if (typeof(encrypted) !== "string")
        throw new Error("encrypted value should be a string");
    if (encrypted.indexOf(PREFIX) !== 0)
        throw new Error("corrupt encrypted value");
    return encrypted.slice(PREFIX.length);
};

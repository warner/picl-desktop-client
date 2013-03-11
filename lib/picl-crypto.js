
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


function computeVerhash(KEVs) {
    var h = new VerHash();
    var keys = Object.getOwnPropertyNames(KEVs).sort();
    keys.forEach(function(key) {
        // TODO: proper safe concatenation
        h.update(key);
        h.update(KEVs[key]);
    });
    return h.hexdigest();
};
exports.computeVerhash = computeVerhash;

const SIGNPREFIX = "signed:";

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
exports.extractVerhash = function(signed) {
    // just extract the data, don't actually verify anything, since we don't
    // have the key here
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


const sjcl = require("./sjcl");

function VerHash() {
}

VerHash.prototype.update = function(data) {};
VerHash.prototype.hexdigest = function() {
    return "deadbeef";
};
exports.VerHash = VerHash;

exports.signVerhash = function(key, seqnum, verhash) {
    var signable = JSON.stringify({seqnum: seqnum,
                                   verhash: verhash});
    return signable;
};
exports.verifyVerhash = function(key, signed) {
    var signable = JSON.parse(signed);
    return {seqnum: signable.seqnum,
            verhash: signable.verhash};
};

const PREFIX = "encrypted:";

exports.encryptKV = function(key, value) {
    return PREFIX+value;
};

exports.decryptKVE = function(key, encrypted) {
    if (typeof(encrypted) !== "string")
        throw new Error("encrypted value should be a string");
    if (encrypted.indexOf(PREFIX) !== 0)
        throw new Error("corrupt encrypted value");
    return encrypted.slice(PREFIX.length);
};

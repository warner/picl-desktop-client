
const assert = require("assert");
const VersionStore = require("./versions").VersionStore;

var vs = new VersionStore("key", "db");
var nv1 = vs.createFirstVersion();
nv1.setKV("key1", "value1");
nv1.setKV("key2", "value2");
//console.log(JSON.stringify(nv1));
var v1 = nv1.close();
console.log("v1", v1);
console.log("verhash", v1.getVerhash());
assert(v1.getSeqnum(), 1);
console.log("signed", v1.getSignedVerhash());
console.log("v1 again", v1);


console.log("yay");

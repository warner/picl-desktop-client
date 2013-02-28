const VersionStore = require("versions").VersionStore;
var L = require("logger");

exports["test basics"] = function(assert, done) {
    var vs = new VersionStore("key", "db");
    var nv1 = vs.createFirstVersion();
    assert.ok(nv1);
    nv1.setKV("key1", "value1");
    nv1.setKV("key2", "value2");
    nv1.setKV("key3", "value3");
    var v1 = nv1.close();
    assert.ok(v1);
    console.log("v1", v1);
    console.log("verhash", v1.getVerhash());
    assert.equal(v1.getSeqnum(), 1);
    console.log("signed", v1.getSignedVerhash());
    console.log("v1 again", v1);

    var v1kvs = v1.iterKVs();
    console.log(v1kvs);
    var v1kevs = v1.iterKEVs();
    console.log(v1kevs);



    var nv2 = v1.createNextVersion();
    nv2.deleteKey("key1");
    nv2.setKV("key3", "newvalue3");
    nv2.setKV("key4", "value4");
    var v2 = nv2.close();
    console.log(v2);

    var delta1to2 = v2.createDeltaFrom(v1);
    console.log(delta1to2);
    assert.deepEqual(delta1to2.sort(),
                     [["del", "key1"],
                      ["set", "key3", "encrypted:newvalue3"],
                      ["set", "key4", "encrypted:value4"]].sort());

    /*
    assert.ok(1);
    assert.equal(1, 1);
    if (0) assert.fail();
    L.log("VERSION test");*/
    done();
};


require("sdk/test").run(exports);

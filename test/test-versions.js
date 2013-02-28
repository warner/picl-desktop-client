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

    assert.deepEqual(v1.iterKVs().sort(),
                     [["key1", "value1"],
                      ["key2", "value2"],
                      ["key3", "value3"]].sort());
    assert.deepEqual(v1.iterKEVs().sort(),
                     [["key1", "encrypted:value1"],
                      ["key2", "encrypted:value2"],
                      ["key3", "encrypted:value3"]].sort());


    // outbound
    var nv2 = v1.createNextVersion();
    nv2.deleteKey("key1");
    nv2.setKV("key3", "newvalue3");
    nv2.setKV("key4", "value4");
    var v2 = nv2.close();
    console.log(v2);

    assert.deepEqual(v2.iterKVs().sort(),
                     [["key2", "value2"],
                      ["key3", "newvalue3"],
                      ["key4", "value4"]].sort());
    assert.deepEqual(v2.iterKEVs().sort(),
                     [["key2", "encrypted:value2"],
                      ["key3", "encrypted:newvalue3"],
                      ["key4", "encrypted:value4"]].sort());


    var delta1to2 = v2.createDeltaFrom(v1);
    console.log(delta1to2);
    assert.deepEqual(delta1to2.sort(),
                     [["del", "key1"],
                      ["set", "key3", "encrypted:newvalue3"],
                      ["set", "key4", "encrypted:value4"]].sort());

    // inbound
    var nv2a = v1.createNewVersion(v2.getSignedVerhash());
    for (let delta in delta1to2) {
        if (delta[0] == "del")
            nv2a.deleteKey(delta[1]);
        else if (delta[0] == "set")
            nv2a.setKVE(delta[1], delta[2]);
    }
    var v2a = nv2a.close();
    console.log(v2a);
    assert.deepEqual(v2a.iterKVs().sort(),
                     [["key2", "value2"],
                      ["key3", "newvalue3"],
                      ["key4", "value4"]].sort());

    /*
    assert.ok(1);
    assert.equal(1, 1);
    if (0) assert.fail();
    L.log("VERSION test");*/
    done();
};


require("sdk/test").run(exports);

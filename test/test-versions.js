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
    L.log("v1", v1);
    L.log("verhash", v1.getVerhash());
    assert.equal(v1.getSeqnum(), 1);
    L.log("signed", v1.getSignedVerhash());
    L.log("v1 again", v1);

    const expectedV1 = [["key1", "value1"],
                        ["key2", "value2"],
                        ["key3", "value3"]];
    const expectedEV1 = [["key1", "encrypted:value1"],
                         ["key2", "encrypted:value2"],
                         ["key3", "encrypted:value3"]];
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedEV1.sort());
    assert.deepEqual(vs.getVersion(v1.getVerhash()).iterKVs().sort(),
                     expectedV1.sort());


    // outbound
    var nv2 = v1.createNextVersion();
    L.log("nv2 is", nv2);
    L.log("v1 is still", v1);
    nv2.deleteKey("key1");
    nv2.setKV("key3", "newvalue3");
    nv2.setKV("key4", "value4");
    var v2 = nv2.close();
    L.log("v2 is", v2);

    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedEV1.sort());
    const expectedV2 = [["key2", "value2"],
                        ["key3", "newvalue3"],
                        ["key4", "value4"]];
    const expectedEV2 = [["key2", "encrypted:value2"],
                         ["key3", "encrypted:newvalue3"],
                         ["key4", "encrypted:value4"]];
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2.iterKEVs().sort(), expectedEV2.sort());


    var delta1to2 = v2.createDeltaFrom(v1);
    L.log(delta1to2);
    assert.deepEqual(delta1to2.sort(),
                     [["del", "key1"],
                      ["set", "key3", "encrypted:newvalue3"],
                      ["set", "key4", "encrypted:value4"]].sort());

    // inbound with a delta
    var nv2a = v1.createNewVersion(v2.getSignedVerhash());
    L.log("nv2a", nv2a);
    for (let delta of delta1to2) {
        if (delta[0] == "del")
            nv2a.deleteKey(delta[1]);
        else if (delta[0] == "set")
            nv2a.setKEV(delta[1], delta[2]);
    }
    var v2a = nv2a.close();
    L.log("v2a", v2a);

    assert.deepEqual(v2a.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2a.iterKEVs().sort(), expectedEV2.sort());
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2.iterKEVs().sort(), expectedEV2.sort());
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedEV1.sort());

    // inbound without any delta
    var nv2b = vs.createNewVersion(v2.getSignedVerhash());
    for (let KEV of v2.iterKEVs()) {
        nv2b.setKEV(KEV[0], KEV[1]);
    }
    var v2b = nv2b.close();

    assert.deepEqual(v2b.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2b.iterKEVs().sort(), expectedEV2.sort());
    assert.deepEqual(v2a.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2a.iterKEVs().sort(), expectedEV2.sort());
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2.iterKEVs().sort(), expectedEV2.sort());
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedEV1.sort());

    /*
    assert.ok(1);
    assert.equal(1, 1);
    if (0) assert.fail();
    L.log("VERSION test");*/
    done();
};


require("sdk/test").run(exports);

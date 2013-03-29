
const client = require("client-versions");
const decryptKEV = client._for_tests.decryptKEV;
const VersionStore = require("client-versions").VersionStore;
const server = require("server-versions");
const L = require("logger");
const pcrypto = require("picl-crypto");

exports["test basics"] = function(assert, done) {
    var enckey = pcrypto.hashKey("enckey");
    var signkey = pcrypto.hashKey("signkey");
    var vs = new VersionStore(enckey, signkey, "db");
    var nv1 = vs.createFirstVersion();
    assert.ok(nv1);
    nv1.setKV("key1", "value1");
    nv1.setKV("key2", "value2");
    nv1.setKV("key3", "value3");
    var v1 = nv1.close();
    assert.ok(v1);
    L.log("v1", v1);
    assert.equal(v1.getV("key1"), "value1");
    assert.equal(v1.getV("key2"), "value2");
    assert.equal(decryptKEV(enckey, v1.getEV("key1")), "value1");
    L.log("verhash", v1.getVerhash());
    assert.equal(v1.getSeqnum(), 1);
    assert.strictEqual(v1, vs.getVersion(v1.getVerhash()));
    var sigv = v1.getSignedVerhash();
    pcrypto.verifyVerhash(signkey, sigv);
    assert.equal(pcrypto.extractVerhash(sigv).seqnum, 1);
    assert.equal(pcrypto.extractVerhash(sigv).verhash, v1.getVerhash());
    L.log("signed", v1.getSignedVerhash());
    L.log("v1 again", v1);

    const expectedV1 = [["key1", "value1"],
                        ["key2", "value2"],
                        ["key3", "value3"]];
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(expectedV1,
                     v1.iterKEVs().map(function(a) {
                         return [a[0], decryptKEV(enckey, a[1])];
                         }).sort());
    var expectedKEV1 = v1.iterKEVs();
    assert.deepEqual(vs.getVersion(v1.getVerhash()).iterKVs().sort(),
                     expectedV1.sort());
    assert.deepEqual(v1.getAllKVs(), {key1: "value1",
                                      key2: "value2",
                                      key3: "value3"});

    // outbound
    var nv2 = v1.createNextVersion();
    L.log("nv2 is", nv2);
    L.log("v1 is still", v1);
    nv2.deleteKey("key1");
    nv2.setKV("key3", "newvalue3");
    nv2.setKV("key4", "value4");
    var v2 = nv2.close();
    L.log("v2 is", v2);

    assert.equal(v2.getSeqnum(), 2);
    assert.strictEqual(v2, vs.getVersion(v2.getVerhash()));
    const expectedV2 = [["key2", "value2"],
                        ["key3", "newvalue3"],
                        ["key4", "value4"]];
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(expectedV2,
                     v2.iterKEVs().map(function(a) {
                         return [a[0], decryptKEV(enckey, a[1])];
                         }).sort());
    var expectedKEV2 = v2.iterKEVs();
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(expectedKEV1.sort(), v1.iterKEVs().sort());


    var delta1to2 = v2.createDeltaFrom(v1);
    L.log(delta1to2);
    var expectedDelta1to2 = [["key1", "del"],
                             ["key3", "set", "newvalue3"],
                             ["key4", "set", "value4"]];
    assert.deepEqual(delta1to2.sort().map(function(a) {
        if (a[1] == "set")
            return [a[0], a[1], decryptKEV(enckey, a[2])];
        return a;
    }), expectedDelta1to2.sort());

    var nv3 = v2.createNextVersion();
    nv3.setAllKVs({key2: "value2", key3: "newervalue3"});
    var v3 = nv3.close();
    const expectedV3 = [["key2", "value2"],
                        ["key3", "newervalue3"]];
    assert.deepEqual(v3.iterKVs().sort(), expectedV3.sort());
    // key2, which didn't change, should not be re-encrypted
    assert.equal(v3.getEV("key2"), v2.getEV("key2"));
    assert.deepEqual(expectedV3,
                     v3.iterKEVs().map(function(a) {
                         return [a[0], decryptKEV(enckey, a[1])];
                         }).sort());

    // inbound with a delta
    var nv2a = v1.createNewVersion(v2.getSignedVerhash());
    L.log("nv2a", nv2a);
    for (let delta of delta1to2) {
        if (delta[1] == "del")
            nv2a.deleteKey(delta[0]);
        else if (delta[1] == "set")
            nv2a.setKEV(delta[0], delta[2]);
    }
    var v2a = nv2a.close();
    L.log("v2a", v2a);

    assert.equal(v2a.getSeqnum(), 2);
    assert.deepEqual(v2a.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2a.iterKEVs().sort(), expectedKEV2.sort());
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2.iterKEVs().sort(), expectedKEV2.sort());
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedKEV1.sort());

    // inbound without any delta
    var nv2b = vs.createNewVersion(v2.getSignedVerhash());
    for (let KEV of v2.iterKEVs()) {
        nv2b.setKEV(KEV[0], KEV[1]);
    }
    var v2b = nv2b.close();

    assert.equal(v2b.getSeqnum(), 2);
    assert.deepEqual(v2b.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2b.iterKEVs().sort(), expectedKEV2.sort());
    assert.deepEqual(v2a.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2a.iterKEVs().sort(), expectedKEV2.sort());
    assert.deepEqual(v2.iterKVs().sort(), expectedV2.sort());
    assert.deepEqual(v2.iterKEVs().sort(), expectedKEV2.sort());
    assert.deepEqual(v1.iterKVs().sort(), expectedV1.sort());
    assert.deepEqual(v1.iterKEVs().sort(), expectedKEV1.sort());

    // bad signature
    assert.throws(function() {
        var good_v1vh = v1.getSignedVerhash();
        var bad_v1vh = "bad"+good_v1vh;
        vs.createNewVersion(bad_v1vh); // should throw
    }, "corrupt version");

    // bad version contents
    assert.throws(function() {
        var nv1 = vs.createNewVersion(v1.getSignedVerhash());
        nv1.setKV("key5", "value5");
        nv1.close(); // should throw
    }, "corrupt new version");

    done();
};

exports["test server versions"] = function(assert, done) {
    var vs = new server.VersionStore("server db");
    var cv = new server.CurrentVersion(vs);

    var signkey = pcrypto.hashKey("signkey");
    var v1_verhash = pcrypto.computeVerhash({"key1": "encval1"});
    var v1_sighash = pcrypto.signVerhash(signkey, 1, v1_verhash);
    var nv1 = vs.createNewVersion(v1_sighash);
    nv1.setKEV("key1", "encval1");
    var v1 = nv1.close();
    assert.equal(v1_verhash, v1.getVerhash());
    var out = cv.replaceVersion(v1);
    assert.equal(out.getVerhash(), v1_verhash);

    var v2_verhash = pcrypto.computeVerhash({"key1": "encval1",
                                             "key2": "encval2"});
    var v2_sighash = pcrypto.signVerhash(signkey, 2, v2_verhash);
    var nv2 = vs.createNewVersion(v2_sighash);
    nv2.setKEV("key1", "encval1");
    nv2.setKEV("key2", "encval2");
    var v2 = nv2.close();
    assert.equal(v2_verhash, v2.getVerhash());

    out = cv.updateVersion(v1_sighash, v2);
    assert.equal(out.getVerhash(), v2_verhash);

    // out-of-date, returns old value
    out = cv.updateVersion(v1_sighash, v2);
    assert.equal(out.getVerhash(), v2_verhash);

    done();
};



require("sdk/test").run(exports);

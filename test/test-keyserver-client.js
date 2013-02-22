var main = require("main");
var KeyServerClient = require("./keyserver-client");

function generateTestEmail() {
  return "test+"+Math.floor((1+Math.random())*1000000)+"@test.com";
};

exports["test KeyServerClient.createUser with valid email"] = function(assert, done) {
  var ksClient = new KeyServerClient();
  var email = generateTestEmail();
  ksClient.createUser(email).
  then(function (result) {
    assert.equal(result.version, 1, "Returns user version is intialized to 1");
    assert.equal(result.kA.length, 64, "Returns 256 bit kA");
    assert.equal(result.deviceId.length, 64, "Returns 256 bit device id");
    done();
  }, function (err) {
    console.log("error "+err.text+" "+err.status);
    assert.fail();
    done();
  });
};

exports["test KeyServerClient.createUser with missing email"] = function(assert, done) {
  var ksClient = new KeyServerClient();
  ksClient.createUser(null).
  then(function (result) {
    console.log("shouldn't succeed: "+JSON.stringify(result));
    assert.fail();
    done();
  }, function (err) {
    assert.equal(err.code, 400, "HTTP status code should be 400");
    assert.equal(err.message, "Invalid parameter: email = undefined", "Error message should complain about missing email");
    done();
  });
};

exports["test KeyServerClient.getUser with valid email and previously created user"] = function(assert, done) {
  var ksClient = new KeyServerClient();
  var email = generateTestEmail();
  var kA;
  ksClient.createUser(email).
  then(function (result) {
    kA = result.kA;
    return ksClient.getUser(email);
  }).
  then(function(result) {
    assert.ok(result.version > 0, "Returns user version > 0");
    assert.ok(result.kA.length === 64 && result.kA === kA, "Returns same 256 bit kA returned by userCreate");
    done();
  }, function (err) {
    console.log("error "+err.text+" "+err.status);
    assert.fail();
    done();
  });
};

exports["test KeyServerClient.getUser with missing email"] = function(assert, done) {
  var ksClient = new KeyServerClient();
  ksClient.getUser(null).
  then(function (result) {
    console.log("shouldn't succeed: "+JSON.stringify(result));
    assert.fail();
    done();
  }, function (err) {
    assert.equal(err.code, 400, "HTTP status code should be 400");
    assert.equal(err.message, "Invalid parameter: email = undefined", "Error message should complain about missing email");
    done();
  });
};

require("sdk/test").run(exports);

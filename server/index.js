#!/usr/bin/env node

var express = require("express");
var Server = require('./lib/server.js').Server;

var s = new Server();

var app = express();
app.use(express.logger());
app.use(express.bodyParser());
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    return next();
    });

app.post("/api", function(req, res) {
    s.messageReceived(req.body)
        .then(function (r) {res.send(r);},
              function (err) {res.send(500, err);});
});

app.listen(8081);
console.log("listening on port 8081");

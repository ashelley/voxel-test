var path = require('path');
var http = require('http');
var express = require('express');
var app = express();
var server = http.createServer(app);
var voxelServer;

app.use(express.static(path.resolve(__dirname, 'voxel-client', 'www')));
voxelServer = require('./voxel-server')(server);


server.listen(process.env.PORT || 3000);


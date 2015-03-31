var url = require('url')
var websocket = require('websocket-stream')
var engine = require('voxel-engine')
var duplexEmitter = require('duplex-emitter')
var toolbar = require('toolbar')
var randomName = require('./randomname')
var crunch = require('voxel-crunch')
var emitChat = require('./chat')
var highlight = require('voxel-highlight')
var skin = require('minecraft-skin')
var player = require('voxel-player');
var walk = require('voxel-walk');
var rescue = require('voxel-rescue');
var texturePath = "textures/"
//var game

module.exports = Client

function Client(server, game) {
  if(!(this instanceof Client)) {
    return new Client(server, game)
  }
  this.blockSelector = toolbar({el: '#tools'})  

  this.playerID
  this.lastProcessedSeq = 0
  this.localInputs = []
  this.connected = false
  this.currentMaterial = 1
  this.lerpPercent = 0.1
  this.server = server || 'ws://' + url.parse(window.location.href).host
  this.others = {}
  this.connect(server, game)
  this.game
  window.others = this.others
}

Client.prototype.connect = function(server, game) {
  var self = this
  var socket = websocket(server)
  socket.on('end', function() { self.connected = false })
  this.socket = socket
  this.bindEvents(socket, game)
}

Client.prototype.bindEvents = function(socket, game) {
  var self = this
  this.emitter = duplexEmitter(socket)
  var emitter = this.emitter
  this.connected = true

  this.blockSelector.on('select', function(item) {
    self.currentMaterial = +item+1;
  })

  emitter.on('id', function(id) {
    console.log('got id', id)
    self.playerID = id
    if (game != null) {
  	  self.game = game
  	  console.log("Sending local settings to the server.")
  	  emitter.emit('clientSettings', self.game.settings)
    } else {
  	  emitter.emit('clientSettings', null)
    }
  })
  
  emitter.on('settings', function(settings) {
    settings.texturePath = texturePath
    settings.generateChunks = true
	//deserialise the voxel.generator function.
	if (settings.generatorToString != null) {
		settings.generate = eval("(" + settings.generatorToString + ")")
	}
  self.game = self.createGame(settings, game)	
	emitter.emit('created')
    emitter.on('chunk', function(encoded, chunk) {
      var voxels = crunch.decode(encoded, chunk.length)
      chunk.voxels = voxels
      self.game.showChunk(chunk)
    })
  })

  // fires when server sends us voxel edits
  emitter.on('set', function(pos, val) {
    self.game.setBlock(pos, val)
  })
}

Client.prototype.createGame = function(settings, game) {
  var self = this
  var emitter = this.emitter

  var lastPlayerState;
  var lastControlsState;
  var controlStateChanged;

  settings.controlsDisabled = false
  self.game = engine(settings)
  self.game.settings = settings

  function sendState(state) {
    if (!self.connected) return
    emitter.emit('state', state)
  }

  function copyPlayerState(player) {
    if(!player) return null;
    var position = new self.game.THREE.Vector3()
    position.copy(player.yaw.position);
    var state = {
      position: position,
      rotation: {
        y: player.yaw.rotation.y,
        x: player.pitch.rotation.x
      }
    }
    return state; 
  }

  function isPlayerStateChanged(playerState, currentPlayerState) {
    if(playerState && currentPlayerState) {
      if(playerState.position.x !== currentPlayerState.position.x ||
        playerState.position.y !== currentPlayerState.position.y ||
        playerState.position.z !== currentPlayerState.position.z ||
        playerState.rotation.x !== currentPlayerState.rotation.x ||
        playerState.rotation.y !== currentPlayerState.rotation.y) {
          return true;
      }
    } else if((playerState && !currentPlayerState) ||(!playerState ||currentPlayerState)) {
        return true;
    }
  }

  function copyControlsState(controls) {
    var newState = {};
    for(var i in controls.state) {
      newState[i] = controls.state[i];
    }
    return newState;
  }  

  function isControlsStateChanged(controlsState, controls) {
    if(controlsState) {
      for(var i in controls.state) {
        if(controlsState[i] !== controls.state[i]) {
          return true
        }
      }
    } else {
      if((controlsState && !controls) || (!controlsState && controls)) {
        return true;
      }
    }
  }

  function getPlayerSkinById(id) {
    var playerSkin = self.others[id]
    if (playerSkin) {
      return playerSkin;
    } else {
      playerSkin = skin(self.game.THREE, 'player.png', {
        scale: new self.game.THREE.Vector3(0.04, 0.04, 0.04)
      })
      var playerMesh = playerSkin.mesh
      self.others[id] = playerSkin
      playerMesh.children[0].position.y = 10
      self.game.scene.add(playerMesh)
    }
    return playerSkin;
  }

  var name = localStorage.getItem('name')
  if (!name) {
    name = randomName()
    localStorage.setItem('name', name)
  }

  self.game.controls.on('data', function(state) {
    if(isControlsStateChanged(lastControlsState, self.game.controls)) {
      lastControlsState = copyControlsState(self.game.controls);
      controlStateChanged = true
    }
    /*
    Object.keys(state).map(function(control) {
      if (state[control] > 0) {
        
      }
    })
    */
  })

  emitChat(name, emitter)

  self.game.on('tick', function(delta) {
    var player = self.game.controls.target()
    if(player) {
      var currentPlayerState = copyPlayerState(player);
      if(isPlayerStateChanged(lastPlayerState, currentPlayerState)) {
        sendState(currentPlayerState);
        lastPlayerState = currentPlayerState;        
        controlStateChanged = false;                  
      } else if(controlStateChanged) {
        sendState(currentPlayerState);
        lastPlayerState = currentPlayerState;        
        controlStateChanged = false; 
      }        
    }      
  });

  // setTimeout is because three.js seems to throw errors if you add stuff too soon
  setTimeout(function() {
    emitter.on('update', function(updates) {      
      Object.keys(updates.positions).map(function(playerId) {
        var update = updates.positions[playerId]
        if (playerId === self.playerID) {
          return self.onServerUpdate(update) // local player
        } else {
          var playerSkin = getPlayerSkinById(playerId);
          if(updates.triggerPlayer === playerId) {
            walk.render(playerSkin);
          }
          self.updatePlayerPosition(playerSkin, update) // other players
        }
      })
    })
  }, 1000)

  emitter.on('leave', function(id) {
    if (!self.others[id]) return
    self.game.scene.remove(self.others[id].mesh)
    delete self.others[id]
  })
  
  return self.game
}

Client.prototype.onServerUpdate = function(update) {
  // todo use server sent location
}

Client.prototype.lerpMe = function(position) {
  var to = new this.game.THREE.Vector3()
  to.copy(position)
  var from = this.game.controls.target().yaw.position
  from.copy(from.lerp(to, this.lerpPercent))  
}

Client.prototype.updatePlayerPosition = function(playerSkin, update) {
  var pos = update.position
  var playerMesh = playerSkin.mesh
  //playerMesh.position.copy(playerMesh.position.lerp(pos, this.lerpPercent))
  playerMesh.position.copy(pos);

  // playerMesh.position.y += 17
  playerMesh.children[0].rotation.y = update.rotation.y + (Math.PI / 2)
  playerSkin.head.rotation.z = scale(update.rotation.x, -1.5, 1.5, -0.75, 0.75)
}

function scale( x, fromLow, fromHigh, toLow, toHigh ) {
  return ( x - fromLow ) * ( toHigh - toLow ) / ( fromHigh - fromLow ) + toLow
}

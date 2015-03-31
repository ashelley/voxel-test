var createClient = require('../')
var highlight = require('voxel-highlight')
var extend = require('extend')
var voxelPlayer = require('voxel-player')
var fly = require('voxel-fly')
var walk = require('voxel-walk');
var rescue = require('voxel-rescue');
var game

module.exports = function(opts, setup) {
  setup = setup || defaultSetup
  opts = extend({}, opts || {})

  var client = createClient(opts.server || "ws://localhost:8081/")
  
  client.emitter.on('noMoreChunks', function(id) {
    console.log("Attaching to the container and creating player")
    var container = opts.container || document.body
    game = client.game
    game.appendTo(container)
    if (game.notCapable()) return game
    var createPlayer = voxelPlayer(game)

    // create the player from a minecraft skin file and tell the
    // game to use it as the main player
    var avatar = createPlayer('player.png')
    window.avatar = avatar
    avatar.possess()
    var settings = game.settings.avatarInitialPosition
    avatar.position.set(settings[0],settings[1],settings[2])
    setup(game, avatar, client)
  })

  return game
}

function defaultSetup(game, avatar, client) {

  var makeFly = fly(game)  
  var target = game.controls.target()
  game.flyer = makeFly(target)  


  rescue(game, {
    teleport: true,
    position: [0,100,0],
    dangerZone: {
      lower: {x: -Infinity, y: -Infinity, z: -Infinity},
      upper: {x: Infinity, y: -50, z: Infinity}    
    }
  });

  // highlight blocks when you look at them, hold <Ctrl> for block placement
  var blockPosPlace, blockPosErase
  var hl = game.highlighter = highlight(game, { color: 0xff0000 })
  hl.on('highlight', function (voxelPos) { blockPosErase = voxelPos })
  hl.on('remove', function (voxelPos) { blockPosErase = null })
  hl.on('highlight-adjacent', function (voxelPos) { blockPosPlace = voxelPos })
  hl.on('remove-adjacent', function (voxelPos) { blockPosPlace = null })

  // toggle between first and third person modes
  window.addEventListener('keydown', function (ev) {
    if (ev.keyCode === 'R'.charCodeAt(0)) avatar.toggle()
  })

  // block interaction stuff, uses highlight data
  //var currentMaterial = 1

  game.on('fire', function (target, state) {
    var position = blockPosPlace
    if (position) {
      //client.currentMaterial = 1;
      console.log('creating block with material = ' + client.currentMaterial)
      game.createBlock(position, client.currentMaterial)
      client.emitter.emit('set', position, client.currentMaterial)
    } else {
      position = blockPosErase
      if (position) {
        game.setBlock(position, 0)
        console.log("Erasing point at " + JSON.stringify(position))
        client.emitter.emit('set', position, 0)
      }
    }
  })

  game.on('tick', function(delta) {
      if(game.controls.state.forward || game.controls.state.backward || game.controls.state.left || game.controls.state.right){
        walk.render(avatar.playerSkin);
      }
  });
}
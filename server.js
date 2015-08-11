'use strict';

//change this if you have the chat in a subdirectory, this defaults to website root
//needs a trailing slash
var path = '/';
var server = '[Server]';

var express = require('express'),
	app = express(),
	http = require('http').Server(app),
	io = require('socket.io')(http, {path: path + 'socket.io'}),
	autolinker = require('autolinker'),
	parseUrls = new autolinker({
		phone: false
		});

var usersOnline = [];
var chatLog = [];
var serverMessage;

app.use(path, express.static('public'));

app.get(path, function(req, res) {
	res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', function(socket) {

	var session = {
		username: undefined
	};

	socket.on('verify name', function(name) {
		var available = verifyNameAvailable(name, usersOnline);

		if(available) {
			io.to(socket.id).emit('username available', name);
		} else {
			io.to(socket.id).emit('username taken', name);
		}
	});

	//----------------------------------
	//
	//	Actual user connection - notifies chat and adds to connected users list
	//
	//----------------------------------

	socket.on('user connect', function(data) {

		if(data.reconnect !== true) {
			var connectMsg = {
				message: data.username + ' has connected.',
				time: new Date()
			};

			io.to(socket.id).emit('chat log', chatLog);

			if(serverMessage !== undefined) {
				io.to(socket.id).emit('chat message', {
					message: serverMessage,
					username: server
				});
			}
			
			io.emit('chat message', connectMsg);
			logChat(chatLog, connectMsg);
		}

		session.username = data.username;

		usersOnline.push(data.username);
		usersOnline.sort();
		
		var update = {
			'usernames': usersOnline,
		};

		io.emit('userlist update', update);
	});

	//----------------------------------
	//
	//	User disconnect - removes from list and notifies chat
	//
	//----------------------------------

	socket.on('disconnect', function(socket) {

		if(session.username !== undefined) {
			var disconnectMsg = {
				message: session.username + ' has disconnected.',
				time: new Date()
			};

			io.emit('chat message', disconnectMsg);
			logChat(chatLog, disconnectMsg);

			usersOnline = removeUser(session.username, usersOnline);

			io.emit('userlist update', {
				'usernames': usersOnline,
			});
		}
	});

	//----------------------------------
	//
	//	User reconnect
	//
	//----------------------------------

	socket.on('reconnect', function(socket) {

		if(session.username !== undefined) {

			var connectMsg = {
					message: session.username + ' has reconnected.',
					time: new Date()
				};

			io.to(socket.id).emit('chat log', chatLog);

			if(serverMessage !== undefined) {
				io.to(socket.id).emit('chat message', {
					message: serverMessage,
					time: new Date()
				});
			}
			
			io.emit('chat message', connectMsg);
			logChat(chatLog, connectMsg);

			usersOnline.push(session.username);
			usersOnline.sort();
			
			var update = {
				'usernames': usersOnline,
			};

			io.emit('userlist update', update);
			}

	});

	//----------------------------------
	//
	//	Sends a chat message to client - data format follows. All properties are optional.
	//
	//	data = {
	//		time:
	//		username:
	//		message:
	//	}
	//
	//----------------------------------
	//	TODO: refactor parsing the commands 

	socket.on('chat message', function(data) {

		data.message = escapeHtml(data.message);
		
		if(parseBang(data)) {
			var bang = parseBang(data);

			if(bang.command === 'name') {
				
				if(verifyNameAvailable(bang.newName, usersOnline)) {
					var username = usersOnline.indexOf(bang.oldName);

					session.username = bang.newName;
					
					usersOnline.splice(username, 1);
					usersOnline.push(bang.newName);
					usersOnline.sort();

					data = {
						message: bang.oldName + ' changed their name to ' + bang.newName,
						time: new Date()
					};

					io.to(socket.id).emit('chat message', {
						newName: bang.newName,
						message: 'Name successfully changed to ' + bang.newName,
						time: new Date()
					});

					io.emit('chat message', data);

					logChat(chatLog, data);

					io.emit('userlist update', {
						'usernames': usersOnline,
					});
				} else {
					io.to(socket.id).emit('chat message', {
						message: bang.newName + ' is already taken, please try another name.',
						time: new Date()
					});
				}

			} else if(bang.command === 'servermsg') {
				serverMessage = bang.message;
				io.to(socket.id).emit('chat message', {
					message: 'Server message changed to ' + bang.message,
					time: new Date()
				});
			}

		} else if(parseSlash(data)) {
			data = parseSlash(data);

			data.message = parseUrls.link(data.message);
			
			logChat(chatLog, data);

			io.emit('chat message', data);

		} else {
			//fall back to normal message
			data.message = parseUrls.link(data.message);

			logChat(chatLog, data);

			io.emit('chat message', data);
		}

	});
	
});

//----------------------------------
//
//	Helper functions
//
//----------------------------------

function verifyNameAvailable(name, userList) {
	var usernameTaken = userList.indexOf(name);

	return usernameTaken === -1 ? true : false;
}

function logChat(log, data) {
	var chatLogMax = 100;

	log.push(data);

	if(log.length > chatLogMax) {
		log.shift();
	}

	return log;
}

function removeUser(user, list) {
	var index = list.indexOf(user);

	if(index != -1) {
		list.splice(index, 1);
	}

	return list;
}

function escapeHtml(unsafe) {
return unsafe
     .replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#039;');
	}

function parseSlash(data) {
	var slashMe = /^\/me /i;
	var test = slashMe.test(data.message);

	if(test) {
		return {
			message: data.message.replace(slashMe, '*' + data.username + ' '),
			time: data.time
		};
	} else {
		return false;
	}
}

function parseBang(data) {

	//define regex patterns for commands to be parsed
	var commands = [
		/^!name /i,
		/^!servermsg /i
	];

	var commandNames = [
		'name',
		'servermsg'
	];

	for(var i = 0; i < commands.length; i++) {
		var test = commands[i].test(data.message);

		if(test) {

			if(commandNames[i] === 'name') {
				return {
					command: 'name',
					oldName: data.username,
					newName: data.message.replace(commands[i], '')
				};

			} else if(commandNames[i] === 'servermsg') {
				return {
					command: 'servermsg',
					message: data.message.replace(commands[i], '')
				};
			}
		}
	}
	return false;
}

http.listen(3000, function() {
	console.log('Server started on :3000');
});

//server restart 
process.on('SIGTERM', function () {
  console.log('Server restarting...');
  io.emit('chat message', {
  	message: 'Server is restarting...',
  	refresh: true
  });
  process.exit();
});

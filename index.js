var fs = require('fs-extra');
var async = require('async');
var findRequires = require('find-requires');
var request = require('request');
var _ = require('underscore');
var uglify = require('uglify-js');
var esprima = require('esprima');
var eswalk = require('esprima-walk');
var escodegen = require('escodegen');

var plugins = require('./lib/plugins');

module.exports = function(config){	
	function normalize(parent){
		return function(path){
			var split = path.split('!');
			if(split[1]) path = split[1];
			if(api.config.paths[path]) path = api.config.paths[path].url||api.config.paths[path];
			if(parent) path = path.replace(/^\.\//, parent.match(/(.+)\/.+/)[1]+'/');
			return (split[1]?split[0]+'!':'')+path;
		}
	}

	function getFile(path, callback){
		var s = path.split('!');
		if(s[1]) path = s[1];
		if(path.match(/^http(s)*:\/\//)) request(path, function(e,r,body){
			callback(e, body, true); //callback saying its remote
		});
		else fs.readFile(path, 'utf8', callback);
	}
	
	function parse(js, transformer){
		var parse = esprima.parse(js);
		return escodegen.generate(transformer(parse));
	}
	
	function isCallTo(statement){
		var opts = _.rest(arguments);
		return statement.expression.type == 'CallExpression' && _.contains(opts, statement.expression.callee.name);
	}
	
	function trace(){
		var obj = {
			visited : [],
			pathsConfig : {},
			start : function(paths, each, complete, context){
				context = context||[]; //default to empty
				paths = _.map(paths, function(path){
					var n = normalize(_.last(context))(path);
					if(api.config.paths[path] && api.config.paths[path].url) obj.pathsConfig[n] = api.config.paths[path];
					return n;
				});
				paths = _.difference(paths, context, obj.visited);
				async.each(paths, function(path, pathDone){
					obj.visited.push(path);
					getFile(path, function(e, js, remote){
						if(e) pathDone(e);
						else{
							var split = path.split('!');
							var plugin = split[1]?split[0]:false;
							if(plugin){
								if(!api.plugins[plugin]) pathDone('plugin: '+plugin+' does not exist');
								else api.plugins[plugin](js, function(e, njs){
									if(e) pathDone(e);
									else{
										js = njs;
										cont();
									}
								});
							}else cont();
							function cont(){
								var pathConfig = obj.pathsConfig[path]||{};
								pathConfig.remote = !!remote;
								pathConfig.deps = pathConfig.deps||[];
								if(pathConfig.export){ //nonstandard module
									var e = obj.pathsConfig[path].export;
									js = 'define((function(){'+js+'\nreturn '+e+'})());';
								}else{
									var normer = normalize(path);
									js = parse(js, function(node){
										eswalk(node, function(child){
											if(child.type == 'CallExpression' && child.callee.name == 'require'){
												var dep = child.arguments[0].value
												pathConfig.deps.push(dep);
												child.arguments[0].value = normer(dep);
											}
										});
										return node;
									});
								}
								obj.start(pathConfig.deps, each, function(e){
									each(path, js, pathConfig, context);
									pathDone(e);
								}, context.concat(path));
							}
						}
					});
				}, complete);
			}
		}
		return obj; 
	}
			
	var api = {
		config : config||{},
		plugins : {},
		addPlugins : function(plugins){
			_.each(plugins, function(value, key){
				api.plugins[key] = value;
			});
		},
		modules : {},
		build : function(paths, init, callback){
			var build = "";
			trace().start(paths, function(path, rawjs, pathConfig, context){				
				if(!pathConfig.remote || pathConfig.include) build += parse(rawjs, function(node){
					node.body = _.reduce(node.body, function(memo, statement){
						if(isCallTo(statement, 'define', 'client')){
							statement.expression.callee.name = 'define';
							statement.expression.arguments.unshift({type: 'Literal', value: path});
							memo.push(statement);
						}
						return memo;
					}, []);
					return node;
				});
				else build += 'load(\''+path+'\', '+JSON.stringify(_.map(pathConfig.deps||[], normalize(path)))+', false'+(pathConfig.export?', \''+pathConfig.export+'\'':'')+')';
				build += '\n\n'; 
			}, function(e){
				if(e) callback(e);
				else getFile('lib/client.js', function(e, require){
					require = uglify.minify(require, {fromString: true}).code;
					var output = require+'\n\n'
								 +build
								 +'bilt.init('+init.toString()+', '+JSON.stringify(paths)+')\n';
					if(!api.config.noMinify) output = uglify.minify(output, {fromString: true}).code;
					callback(e, output);
				});
			});	
		},
		require : function(paths, callback, context){
			trace().start(paths, function(path, rawjs, pathConfig, context){
				js = parse(rawjs, function(node){
					node.body = _.reduce(node.body, function(memo, statement){
						if(isCallTo(statement, 'define', 'server')){
							statement.expression.callee.name = 'define';
							memo.push(statement);
						}
						return memo;
					}, []);
					return node;
				});
				function define(value){
					api.modules[path] = value;
				}
				function require(path){
					return api.modules[path];
				}
				eval(js);
			}, function(e){
				callback.apply(this, [e].concat(_.values(_.pick(api.modules, paths))));
			});	
		}
	}
	api.addPlugins(plugins);
	return api;
};
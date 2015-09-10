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

module.exports = function(globalConfig){		
	function normalize(parent, isBuild){
		return function(path){
			var split = path.split('!');
			if(split[1]) path = split[1];
			if(parent) path = path.replace(/^\.\//, parent.match(/(.+)\/.+/)[1]+'/');
			var pathConfig = api.config.paths[path];
			if(pathConfig){
				if(_.isString(pathConfig)) path = pathConfig;
				else{
					if(pathConfig.source) path = pathConfig.source;
					if(!isBuild && pathConfig.nodePath) path = pathConfig.nodePath;
				}
			}
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
	
	function newNormalize(config, context){
		return function(path){
			var current = _.last(context);
			var split = path.split('!');
			if(split[1]) path = split[1];
			if(current) path = path.replace(/^\.\//, current.match(/(.+)\/.+/)[1]+'/');
			var pathConfig = config.paths[path];
			if(pathConfig){
				if(_.isString(pathConfig)) path = pathConfig;
				else{
					if(pathConfig.source) path = pathConfig.source;
					if(!config.isBuild && pathConfig.nodePath) path = pathConfig.nodePath;
				}
			}
			return (split[1]?split[0]+'!':'')+path;
		}
	}
	
	function trace(isBuild){
		var obj = {
			visited : [],
			pathsConfig : {},
			newStart : function(config, each, complete, context){
				context = context||[];
				var depsConfigs = {};
				config.deps = _.map(config.deps, function(path){
					var n = newNormalize(config, context)(path);
					if(config.paths[path] && config.paths[path].source) depsConfigs[n] = config.paths[path];
					return n;
				});
				config.deps = _.difference(config.deps, context, obj.visited);
				config.isBuild = isBuild;
				async.each(config.deps, function(depPath, depDone){
					obj.visited.push(depPath);
					getFile(depPath, function(e, js, remote){
						if(e) depDone(e);
						else{
							var split = depPath.split('!');
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
								var depContext = context.concat(depPath);
								var depConfig = {
									paths : JSON.parse(JSON.stringify(config.paths)),
									deps : [],
									remote : !!remote
								};
								if(depsConfigs[depPath]) _.each(depsConfigs[depPath], function(val, key){
									depConfig[key] = val;
								});
								
								if(depConfig.export) js = 'define((function(){'+js+'\nreturn '+depConfig.export+'})());';
								else js = parse(js, function(node){
									node.body = _.filter(node.body, function(statement){
										var isDefine = statement.expression.type == 'CallExpression' && statement.expression.callee.name == 'define';
										if(isDefine && statement.expression.arguments.length == 2){
											var inlineConfig = statement.expression.arguments.shift();
											inlineConfig = eval('('+escodegen.generate(inlineConfig)+')');
											if(_.isArray(inlineConfig)) depConfig.deps = _.uniq(depConfig.deps.concat(inlineConfig));
											else if(_.isObject(inlineConfig)){
												if(inlineConfig.deps) depConfig.deps = _.uniq(depConfig.deps.concat(inlineConfig.deps));
												if(inlineConfig.paths) _.each(inlineConfig.paths, function(value, path){
													depConfig.paths[path] = value;
												});
											}
										}
										return isDefine;
									});
									eswalk(node, function(child){
										if(child.type == 'CallExpression' && child.callee.name == 'require'){
											var dep = child.arguments[0].value
											depConfig.deps = _.uniq(depConfig.deps.concat(dep));
											child.arguments[0].value = newNormalize(depConfig, depContext)(dep);
										}
									});
									return node;
								});
								
								obj.newStart(depConfig, each, function(e){
									each(depPath, js, depConfig, context);
									depDone(e);
								}, depContext);
							}	
						}
					});
				}, complete)
			}
		}
		return obj; 
	}
			
	var api = {
		config : globalConfig||{},
		plugins : {},
		addPlugins : function(plugins){
			_.each(plugins, function(value, key){
				api.plugins[key] = value;
			});
		},
		modules : {},
		build : function(paths, init, callback){
			var build = "";
			trace(true).newStart({
				paths : api.config.paths,
				deps : paths
			}, function(path, rawjs, pathConfig, context){				
				if(!pathConfig.remote || pathConfig.include) build += parse(rawjs, function(node){
					node.body = _.each(node.body, function(statement){
							statement.expression.arguments.unshift({type: 'Literal', value: path});
					});
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
			trace().newStart({
				paths : api.config.paths,
				deps : paths
			}, function(path, js, pathConfig, context){
				function define(value){
					api.modules[path] = value;
				}
				function require(path){
					return api.modules[path];
				}
				eval(js);
			}, function(e){
				callback.apply(this, _.values(_.pick(api.modules, paths)));
			});	
		}
	}
	api.addPlugins(plugins);
	return api;
};
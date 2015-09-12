var fs = require('fs');
var async = require('async');
var findRequires = require('find-requires');
var request = require('request');
var _ = require('underscore');
var uglify = require('uglify-js');
var esprima = require('esprima');
var eswalk = require('esprima-walk');
var escodegen = require('escodegen');

module.exports = function(globalConfig){
	globalConfig.paths = globalConfig.paths||{};
			
	/* get file by path, local or http(s) */
	function getFile(path, callback){
		var source = _.last(path.split('!'));
		var pluginPaths = _.without(_.initial(path.split('!')), source);
		api.require(pluginPaths, function(){
			var plugins = arguments;
			async.reduce(plugins, source, function(memo, plugin, done){
				var pluginNormalize = plugin.normalize||_.identity;
				done(null, pluginNormalize(memo));
			}, function(e, source){
				if(e) callback(e);
				else if(source.match(/^http(s)*:\/\//)) request(source, function(e,r,body){
					transform(e, body, true); //callback saying its remote
				});
				else fs.readFile(source, 'utf8', transform);
			});
			function transform(e, raw, remote){
				if(e) callback(e);
				else async.reduce(plugins, raw, function(memo, plugin, transformed){
					var transform = plugin.transform||plugin;
					if(_.isFunction(transform)) transform(memo, transformed);
					else transformed(null, memo);
				}, function(e, js){
					callback(e, js, remote, _.object(pluginPaths, plugins));
				});
			}
		});	
	}
	
	function parse(js, transformer){
		var parse = esprima.parse(js);
		return escodegen.generate(transformer(parse));
	}
	
	function getNormalizer(config, context){
		function norm(path, pathContext){
			pathContext = (pathContext||[]).concat(path);
			var current = _.last(context);
			return _.map(path.split('!'), function(path){
				if(current) path = path.replace(/^\.\//, _.last(current.split('!')).match(/(.+)\/.+/)[1]+'/');
				var pathConfig = config.paths[path];
				if(pathConfig){
					if(_.isString(pathConfig)) path = pathConfig;
					else{
						if(pathConfig.source) path = pathConfig.source;
						if(!config.isBuild && pathConfig.nodePath) path = pathConfig.nodePath;
					}
				}
				/* path is now its final value */
				var exists = !!path.match(/^http(s)*:\/\//);
				if(!exists) try{
					exists = !!fs.statSync(path);
				}catch(e){}
				if(!exists){
					if(_.contains(pathContext, path)) throw 'path "'+path+'" failed to resolve';
					path = norm(path, pathContext);
				}
				return path;
			}).join('!');
		}
		return norm;
	}
	
	function trace(isBuild){
		var obj = {
			visited : [],
			pathsConfig : {},
			newStart : function(config, each, complete, context){
				context = context||[];
				var depsConfigs = {};
				config.isBuild = isBuild;
				config.deps = _.map(config.deps, function(path){
					var n = getNormalizer(config, context)(path);
					if(config.paths[path] && config.paths[path].source) depsConfigs[n] = config.paths[path];
					return n;
				});
				config.deps = _.difference(config.deps, context, obj.visited);
				async.each(config.deps, function(depPath, depDone){
					obj.visited.push(depPath);
					getFile(depPath, function(e, js, remote, plugins){
						if(e) depDone(e);
						else{
							var depContext = context.concat(depPath);
							var depConfig = {
								paths : JSON.parse(JSON.stringify(config.paths)),
								deps : [],
								remote : !!remote,
								isBuild : isBuild
							};
							if(depsConfigs[depPath]) _.each(depsConfigs[depPath], function(val, key){
								depConfig[key] = val;
							});
							
							if(_.keys(plugins).length) _.each(plugins, function(plugin, pluginPath){
								if(plugin.init){
									obj.visited.push(pluginPath);
									each(pluginPath, 'define('+plugin.init.toString()+')', depConfig, context);
								}
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
								var requireNormalizer = getNormalizer(depConfig, depContext);
								eswalk(node, function(child){
									if(child.type == 'CallExpression' && child.callee.name == 'require'){
										var dep = child.arguments[0].value
										depConfig.deps = _.uniq(depConfig.deps.concat(dep));
										child.arguments[0].value = requireNormalizer(dep);
									}
								});
								return node;
							});
														
							obj.newStart(depConfig, each, function(e){
								each(depPath, js, depConfig, context);
								depDone(e);
							}, depContext);
						}
					});
				}, function(e){
					complete(e, obj.visited);
				});
			}
		}
		return obj; 
	}
			
	var api = {
		config : globalConfig,
		plugins : {},
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
				else build += 'load(\''+path+'\', '+JSON.stringify(pathConfig.deps||[])+', false'+(pathConfig.export?', \''+pathConfig.export+'\'':'')+')';
				build += '\n\n'; 
			}, function(e, loaded){
				if(e) callback(e);
				else fs.readFile('lib/client.js', 'utf8', function(e, require){
					require = uglify.minify(require, {fromString: true}).code;
					var output = require+'\n\n'
								 +build
								 +'bilt.init('+init.toString()+', '+JSON.stringify(paths)+')\n';
					if(!api.config.noMinify) output = uglify.minify(output, {fromString: true}).code;
					callback(e, output, loaded);
				});
			});	
		},
		require : function(paths, callback, context){			
			function nodeRequire(path){
				return require(path);
			}
			var conf = {
				paths : api.config.paths,
				deps : paths
			};
			trace().newStart(conf, function(path, js, pathConfig, context){
				function define(value){
					api.modules[path] = value;
				}
				function require(path){
					var plugins = path.split('!');
					var rpath = plugins.pop();
					var value = api.modules[path];
					return _.reduce(_.map(plugins, function(pluginPath){
						return api.modules[pluginPath];
					}), function(memo, plugin){
						return plugin?plugin(memo):memo;
					}, value);
				}
				eval(js);
			}, function(e, loaded){
				callback.apply(this, _.values(_.pick(api.modules, _.map(paths, function(path){
					return getNormalizer(conf)(path);
				}))));
			});	
		}
	}
	return api;
};
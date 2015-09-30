var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var findRequires = require('find-requires');
var request = require('request');
var _ = require('underscore');
var uglify = require('uglify-js');
var esprima = require('esprima');
var eswalk = require('esprima-walk');
var escodegen = require('escodegen');
var prequire = require('parent-require');
var nodeResolve = require('require-resolve');

function resolve(path){
    var traveler = module.parent;
    for (;traveler;traveler = traveler.parent){
        var o = nodeResolve(path, traveler.filename);
        if(o) return o.src;
    }
    return null;
}

module.exports = function(globalConfig){
	globalConfig.paths = globalConfig.paths||{};
	globalConfig.paths.noop = path.join(__dirname, 'lib/noop.js');
			
	/* get file by path, local or http(s) */
	function getFile(filePath, config, callback){
    
		var source = _.last(filePath.split('!'));
		var pluginPaths = _.without(_.initial(filePath.split('!')), source);
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
				else if(fs.statSync(source).isDirectory()) transform(null, _.map(fs.readdirSync(source), function(subPath){
					return path.join(source, subPath);
				}));
				else fs.readFile(source, 'utf8', transform);
			});
			function transform(e, raw, remote){
				if(e) callback(e);
				else async.reduce(plugins, raw, function(memo, plugin, transformed){
					var transform = plugin.transform||plugin;
					if(_.isFunction(transform)) transform(memo, source, transformed);
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
	
	function getNormalizer(config){
		var invert = _.reduce(config.paths, function(memo, path, alias){
			if(path.nodePath){
				memo[path.nodePath] = alias;
				memo[path.source||path] = alias;
			}
			return memo;
		}, {});
		function norm(path, pathContext){
			pathContext = (pathContext||[]).concat(path);
			var current = _.last(config.context);
			return _.map(path.split('!'), function(path){
				if(invert[path]) path = invert[path];
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
					if(_.contains(pathContext, path)){
				        var resolved = resolve(path);
				        if(resolved) path = resolved;
					    else throw 'path "'+path+'" failed to resolve';
				    }
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
			configs : {},
			newStart : function(config, each, complete){
				config.context = config.context||[];
				var depsConfigs = {};
				config.isBuild = isBuild;
				config.deps = _.map(config.deps, function(path){
					var n = getNormalizer(config)(path);
					if(config.paths[path] && config.paths[path].source) depsConfigs[n] = config.paths[path];
					return n;
				});
				config.deps = _.difference(config.deps, config.context, obj.visited);
				async.each(config.deps, function(depPath, depDone){
					obj.visited.push(depPath);
					getFile(depPath, config, function(e, js, remote, plugins){
						if(e) depDone(e);
						else{
							var depConfig = {
								paths : JSON.parse(JSON.stringify(config.paths)),
								deps : [],
								remote : !!remote,
								isBuild : isBuild,
								context : config.context.concat(depPath)
							};
							
							var specificConfig = {};
							
							if(depsConfigs[depPath]) _.each(depsConfigs[depPath], function(val, key){
								depConfig[key] = val;
								specificConfig[key] = val;
							});
														
							if(_.keys(plugins).length) _.each(plugins, function(plugin, pluginPath){
								if(_.has(plugin, 'init')) depConfig.deps.push(pluginPath);
							});
																																			
							if(depConfig.export){
								js = 'define((function(){'+js+'\nreturn '+depConfig.export+'})());';
							}else js = parse(js, function(node){
								node.body = _.filter(node.body, function(statement){
									var isDefine = statement.expression && statement.expression.type == 'CallExpression' && statement.expression.callee.name == 'define';
									if(isDefine && statement.expression.arguments.length == 2){
										var inlineConfig = statement.expression.arguments.shift();
										inlineConfig = eval('('+escodegen.generate(inlineConfig)+')');
										if(_.isArray(inlineConfig)) depConfig.deps = _.uniq(depConfig.deps.concat(inlineConfig));
										else if(_.isObject(inlineConfig)){
											specificConfig = _.extend(specificConfig, inlineConfig);
											if(inlineConfig.deps) depConfig.deps = _.uniq(depConfig.deps.concat(inlineConfig.deps));
											if(inlineConfig.paths) _.each(inlineConfig.paths, function(value, path){
												depConfig.paths[path] = value;
											});
										}
									}
									return isDefine;
								});
								var requireNormalizer = getNormalizer(depConfig);
								eswalk(node, function(child){
									if(child.type == 'CallExpression' && (
									  (child.callee.name == 'browser' && !isBuild) ||
									  (child.callee.name == 'node' && isBuild)
									)) child.arguments = [];
									else if(child.type == 'CallExpression' && child.callee.name == 'require'){
										var dep = child.arguments[0].value
										depConfig.deps = _.uniq(depConfig.deps.concat(dep));
										child.arguments[0].value = requireNormalizer(dep);
									}
								});
								return node;
							});
														
							obj.configs[depPath] = specificConfig;
														
							obj.newStart(depConfig, each, function(e){
								each(depPath, js, depConfig);
								depDone(e);
							});
						}
					});
				}, function(e){
					complete(e, obj.visited, obj.configs);
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
			var conf = {
				paths : api.config.paths,
				deps : paths
			};
			trace(true).newStart(conf, function(path, rawjs, pathConfig){
				var js = '';
				if(!pathConfig.remote || pathConfig.include) js = parse(rawjs, function(node){
					node.body = _.each(node.body, function(statement){
							statement.expression.arguments.unshift({type: 'Literal', value: path});
					});
					return node;
				});
				else js = 'load(\''+path+'\', '+JSON.stringify(pathConfig.deps||[])+', false'+(pathConfig.export?', \''+pathConfig.export+'\'':'')+')';
				if(pathConfig.minify) js = uglify.minify(js, {fromString: true}).code;
				if(js.length) build += js+'\n\n'; 
			}, function(e, loaded, configs){
				if(e) callback(e);
				else fs.readFile(path.join(__dirname, 'lib/client.js'), 'utf8', function(e, require){
					require = uglify.minify(require, {fromString: true}).code;
					var output = require+'\n\n'
								 +build
								 +escodegen.generate(esprima.parse('bilt.init('+init.toString()+', '+JSON.stringify(_.map(paths, function(spath){
								 	return getNormalizer(conf)(spath);
								 }))+')\n'));
					if(!api.config.noMinify) output = uglify.minify(output, {fromString: true}).code;
					callback(e, output, loaded, configs);
				});
			});	
		},
		require : function(paths, callback, showConfig){			
			function nodeRequire(path){
				return prequire(path);
			}
			var conf = {
				paths : api.config.paths,
				deps : paths
			};
			var normalizedPaths = _.map(paths, function(path){
				return getNormalizer(conf)(path);
			});
			var rconf = {};
			trace().newStart(conf, function(path, js, pathConfig){
				_.extend(rconf, pathConfig);
				function define(value){
					api.modules[path] = value;
					if(_.contains(normalizedPaths, path)) api.modules[path] = require(path);
				}
				function require(path){
					var plugins = path.split('!');
					var rpath = plugins.pop();
					var value = api.modules[path];
					return _.reduce(_.map(plugins, function(pluginPath){
						return api.modules[pluginPath];
					}), function(memo, plugin){
						return plugin?plugin.init(memo):memo;
					}, value);
				}
				function browser(){
					return null;
				}
				function node(v){
					return v;
				}
				eval(js);
			}, function(e, loaded){
				if(showConfig) callback(e, loaded, rconf);
				else callback.apply(this, _.values(_.pick(api.modules, normalizedPaths)));
			});	
		}
	}
	return api;
};
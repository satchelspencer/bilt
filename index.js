var fs = require('fs-extra');
var nodePath = require('path');
var async = require('async');
var checksum = require('checksum');
var request = require('request');
var _ = require('underscore');
var uglify = require('uglify-js');
var esprima = require('esprima');
var eswalk = require('esprima-walk');
var escodegen = require('escodegen');
var prequire = require('parent-require');
var nodeResolve = require('require-resolve');
var path = require('path');

module.exports = function(config){
	config = config||{};
	config.paths = config.paths||{};
	config.deps = config.deps||[];
	config.minify = !!config.minify; //def false
	config.context = config.context||[];

	var modules = {};
	var defineJs = fs.readFileSync(nodePath.join(__dirname, 'lib/define.js'), 'utf8');

	function resolveNodePath(path){
		var traveler = module.parent;
		for (;traveler;traveler = traveler.parent){
			var o = nodeResolve(path, traveler.filename);
			if(o) return o.src;
		}
		return null;
	}

	function normalize(path, config, isBuild){
		var parts = path.split('!');
		function n(path, context){
			if(_.contains(context, path)) return path; //no new info on iteration. return
			else context.push(path);
			/* normalize configured aliases */
			var pathConfig = config.paths[path];
			if(pathConfig){
				if(_.isString(pathConfig)) path = pathConfig;
				else{ //if build, use node
					if(pathConfig.source) path = pathConfig.source;
					if(!isBuild && pathConfig.nodePath) path = pathConfig.nodePath;
				}
			}
			/* normalize relative path */
			if(path.match(/^\.\//) && config.context.length){
				path = nodePath.join(nodePath.dirname(_.last(_.last(config.context).split('!'))), path);
			}
			path = resolveNodePath(path)||path; //if available resolve node path
			return n(path, context);
		}
		/* normalize each part individually */
		return _.map(parts, function(part){
			return n(part, []);
		}).join('!');
		
	}

	/* oversimplified, works for now */
	function extendConfigs(dest, src){
		_.each(src, function(val, prop){
			if(prop == 'deps') dest.deps = _.uniq(dest.deps.concat(val));
			else if(prop == 'paths') _.extend(dest.paths, val);
			else dest[prop] = val;
		})
	}

	/* if source is a directory call back with the absolute paths of all its contents, otherwise open */
	function open(source, callback){
		try{
			var stat = fs.statSync(source);
			if(fs.statSync(source).isDirectory()) callback(null, _.map(fs.readdirSync(source), function(subPath){
				return nodePath.join(source, subPath);
			}))
			else fs.readFile(source, 'utf8', callback);
		}catch(e){
			callback(e);
		}
	}

	var visited = {
		build : [],
		require : [],
	};

	function cacheInit(config){
		if(config.cache && !visited.cache){
			visited.configpath = config.cache;
			fs.ensureFileSync(visited.configpath);
			try{
				visited.cache = fs.readJsonSync(visited.configpath);
			}catch(e){
				visited.cache = {};
			}
			visited.newcache = {};
		}
	}

	function cacheDone(){
		if(visited.configpath) fs.writeFileSync(visited.configpath, JSON.stringify(visited.newcache))
	}

	function trace(traceConfig, eachModule, traceComplete, isBuild, cache){
		traceConfig.cache = cache;
		traceConfig.paths = traceConfig.paths||{};
		traceConfig.deps = traceConfig.deps||[];
		traceConfig.context = traceConfig.context||[];
		/* depthify normalized configs */
		var normalizedConfigs = {};
		_.each(traceConfig.paths, function(pathConfig, path){
			var normalizedPath = normalize(path, traceConfig, isBuild);
			normalizedConfigs[normalizedPath] = normalizedConfigs[normalizedPath]||{};
			var normalizedConfig = normalizedConfigs[normalizedPath];
			/* only extend one level deep, but smartly */
			if(_.isString(pathConfig)) normalizedConfig.source = pathConfig;
			else _.extend(normalizedConfig, _.omit(pathConfig, 'source', 'nodePath'));
		});
		/* for each dep */
		async.eachSeries(traceConfig.deps, function(traceDepPath, traceDepComplete){
			traceDepPath =  normalize(traceDepPath, traceConfig, isBuild);  //normalize path
			var plugins = traceDepPath.split('!');
			var filePath = plugins.pop();
			if(_.contains(visited[isBuild?'build':'require'], traceDepPath)) traceDepComplete(); //already done, skip 'er
			else{
				visited[isBuild?'build':'require'].push(traceDepPath); //add er to donesies
				var pluginTrace = JSON.parse(JSON.stringify(traceConfig));
				pluginTrace.deps = plugins;
				pluginTrace.verbose = false;
				bilt.require(pluginTrace, function(e, pluginModules){
					if(e) traceDepComplete(e);
					else{
						var pluginPrefix = _.keys(pluginModules).concat('').join('!');
						open(filePath, function(e, raw){
							if(e) traceDepComplete('failed to open: '+filePath);
							else{
								/* check against cache */
								var check = checksum(raw+JSON.stringify(traceConfig));
								var cached = visited.cache[check];
								if(cached) ready(cached.config, cached.js, cached.ownConfig, check);
								else{
									console.log('-', filePath);
									/* transform raw by plugins */
									async.reduce(_.keys(pluginModules), raw, function(memo, pluginPath, transformDone){
										var transform = pluginModules[pluginPath].transform||pluginModules[pluginPath];
										if(_.isFunction(transform)) transform(memo, filePath, transformDone);
										else transformDone(null, memo);
									}, function(e, raw){
										filePath = pluginPrefix+filePath; //add plugins back to filename
										try{ var parse = esprima.parse(raw); }catch(e){
											traceDepComplete(filePath+': '+e);
										}
										if(parse){
											var ownConfig = normalizedConfigs[filePath]||{};
											ownConfig.deps = ownConfig.deps||[];
											ownConfig.paths = ownConfig.paths||{};
											var newTraceConfig = JSON.parse(JSON.stringify(traceConfig));
											newTraceConfig.deps = ownConfig.deps; 
											newTraceConfig.context.push(filePath);
											/* find what plugins will be needed at runtime */
											var neededPlugins = _.filter(_.keys(pluginModules), function(pluginPath){
												return _.has(pluginModules[pluginPath], 'init');
											})
											newTraceConfig.deps = _.uniq(newTraceConfig.deps.concat(neededPlugins)); //add needed plugins as deps
											if(ownConfig.export){
												/* shim from export variable */
												var exportDeps = _.map(ownConfig.deps, function(ownDep){
													var normOwnDep = normalize(ownDep, traceConfig, isBuild);
													var exp = normalizedConfigs[normOwnDep] && normalizedConfigs[normOwnDep].export;
													return exp?"var "+exp+" = require('"+normOwnDep+"');":'';
												}).join('\n');
												parse = esprima.parse('define({factory : true}, function(){'+exportDeps+'\n'+escodegen.generate(parse)+'\n return '+ownConfig.export+';});');
											}else if(ownConfig.amd){
												/* compatabilize, replace define with amd */
												eswalk(parse, function(child){
													if(child.callee && child.callee.name == 'define') child.callee.name = 'amd';
													if(child.name == 'define') child.name = 'amd';
												});
												parse = esprima.parse('define({factory : true}, function(){return (function(){amdModules = {};'+escodegen.generate(parse)+' return amdModules["'+ownConfig.amd+'"]})()});');
											}
											eswalk(parse, function(child){
												if(child.type == 'CallExpression' && child.callee.name == 'define'){
													/* 2 args means inline config, remove and extend into ownConfig */
													if(child.arguments.length == 2){
														var inlineConfig = eval('('+escodegen.generate(child.arguments.shift())+')');
														if(_.isArray(inlineConfig) && !ownConfig.export) inlineConfig = {deps : _.uniq(ownConfig.deps.concat(inlineConfig))};										
														extendConfigs(ownConfig, inlineConfig); //inherit to ownConfig
														extendConfigs(newTraceConfig, ownConfig);
													}
													/* wrap it in a return function */
													child.arguments[0] = {
														type: 'FunctionExpression',
														id: null,
														params: [],
														defaults: [],
														body : {
															type : 'BlockStatement',
															body : [{
																type : 'ReturnStatement',
																argument : child.arguments[0]
															}]
														},
														generator: false,
														expression: false
													};
												}else if(child.type == 'CallExpression' && ( //environment exclusion fns
												  (child.callee.name == 'browser' && !isBuild) ||
												  (child.callee.name == 'node' && isBuild)
												)) child.arguments = [];
												else if(
													child.type == 'CallExpression' &&
													child.callee.name == 'require' &&
													child.arguments[0] &&
													child.arguments[0].type == 'Literal'
												){ //find all our deps
													var dep = child.arguments[0].value
													ownConfig.deps = _.uniq(ownConfig.deps.concat(dep));
													child.arguments[0].value = normalize(dep, newTraceConfig, isBuild);
												}
											});
											/* extend again to include required paths */
											extendConfigs(newTraceConfig, ownConfig);
											ownConfig.deps = _.map(ownConfig.deps, function(ownDep){
												return normalize(ownDep, newTraceConfig, isBuild);
											});
											/* clean up ownconfig */
											if(!ownConfig.deps.length) delete ownConfig.deps;
											if(!_.keys(ownConfig.paths).length) delete ownConfig.paths;
											delete ownConfig.source;
											/* now that all deps are in, add ownconfigs at front */
											eswalk(parse, function(child){
												if(child.type == 'CallExpression' && child.callee.name == 'define'){
													var parsedOwnConfig = esprima.parse('('+JSON.stringify(ownConfig)+')').body[0].expression;
													child.arguments.unshift(parsedOwnConfig);
													child.arguments.unshift(esprima.parse("'"+filePath+"'").body[0].expression);
												}
											})
											var js = escodegen.generate(parse); //final js
											/* fetching a property from newTraceConfig makes it inheritable */
											if(newTraceConfig.minify) js = uglify.minify(js, {fromString: true}).code;
											ready(newTraceConfig, js, ownConfig, check);
										}
									});
								}
							}
						})

						function ready(newTraceConfig, js, ownConfig, check){
							visited.newcache[check] = {
								config : newTraceConfig,
								js : js,
								ownConfig : ownConfig
							}
							trace(newTraceConfig, eachModule, function(e){
								eachModule(filePath, js, ownConfig);
								traceDepComplete(e);
							}, isBuild);
						}
					}
				}, true)
			}
		}, function(e){
			traceComplete(e, _.uniq(visited[isBuild?'build':'require']));
		})
	}

	var bilt = {
		modules : {},
		require : function(requireConfig, callback, internal){
			function nodeRequire(path){
				return prequire(path);
			}
			var ouputPaths = _.map(requireConfig.deps, function(path){
				return normalize(path, requireConfig);
			});
			eval(defineJs);
			requireConfig.deps = _.difference(requireConfig.deps, _.keys(bilt.modules));
			if(!internal) cacheInit(requireConfig);
			trace(requireConfig, function(path, js){
				function browser(){
					return null;
				}
				function node(v){
					return v;
				}
				eval(js);
			}, function(e, loaded){
				if(!internal) cacheDone();
				waitFor(ouputPaths, function(){
					callback(e, _.mapObject(_.pick(bilt.modules, ouputPaths), function(val){
						return val.value;
					}));
				})					
			}, false)
		},
		build : function(buildConfig, init, callback){
			var output = '';
			cacheInit(buildConfig);
			trace(buildConfig, function(path, js){
				if(js.length) output += js+'\n\n'; 
			}, function(e, loaded){
				cacheDone();
				/* if no problems include the minified client lib */
				if(e) callback(e);
				else fs.readFile(nodePath.join(__dirname, 'lib/client.js'), 'utf8', function(e, require){
					require = defineJs+'\n'+require;
					require = uglify.minify(require, {fromString: true}).code; //minify it
					var initDeps = JSON.stringify(_.map(buildConfig.deps, function(spath){
						return normalize(spath, buildConfig, true);
					}));
					output = require+'\n\n'
									 +output //module's js
									 +escodegen.generate(esprima.parse('waitFor('+initDeps+', '+init.toString()+')\n'));
					if(buildConfig.minify) output = uglify.minify(output, {fromString: true}).code;
					callback(e, loaded, output);
				});
			}, true)
		}
	}
	return bilt;
};
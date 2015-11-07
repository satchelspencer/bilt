function define(path, modConfig, value){
	bilt.modules[path] = bilt.modules[path]||{value:{}};
	bilt.modules[path].config = modConfig;
	bilt.modules[path].waiting = bilt.modules[path].waiting||[];
	
	var plugins = path.split('!'); plugins.pop(); //get plugins
	if(path == '/thumos/load/set.js!sets/projects.js'){
		console.log('start');
	}
	waitFor(modConfig.deps||[], function(deps){
		if(path == '/thumos/load/set.js!sets/projects.js') console.log('back');
		value = value(); //init right now
		if(modConfig.factory) value = value(); //todo: async factories??/? that'd be dope
		/* apply each plugin initalizer if exists */
		initalize(plugins, value);
	}, path);
	
	function initalize(plugins, value){
		var pluginPath = plugins.shift();
		if(!pluginPath) ready(value);
		else{
			var plugin = require(pluginPath);
			if(plugin.init){
				if(plugin.init.length == 1) initalize(plugins, plugin.init(value)); //one arg, synchronous
				else if(plugin.init.length == 2) plugin.init(value, function(e, newValue){ //callback, async
					initalize(plugins, newValue);
				});
				else throw pluginPath+': invalid argument count in initalizer';
			}else initalize(plugins, value);
		}
	}
	
	function ready(finalValue){
		/* set the value in the modules array */
		if(finalValue && finalValue.constructor == Object){
			for(var key in finalValue){
				bilt.modules[path].value[key] = finalValue[key];
			}
		}else bilt.modules[path].value = finalValue;
		/* tell everyone who is waiting that its ready */
		var waiting = bilt.modules[path].waiting||[];
		for(var i in waiting){
			waiting[i](path, bilt.modules[path].value);
		}
		bilt.modules[path].complete = true;
	}

}

function require(path){	
	bilt.modules[path] = bilt.modules[path]||{value:{}};
	return bilt.modules[path].value;
}



function depends(path, dep, context){
	context = context||[];
	var c = false;
	var module = bilt.modules[path];
	if(module && module.config && module.config.deps && context.indexOf(path) == -1){
		context.push(path);
		for(var i in module.config.deps){
			var depPath = module.config.deps[i];
			if(depPath == dep || depends(depPath, dep, context)) c = true;
		}
	}
	return c;
}

function waitFor(paths, callback, self){
	if(!paths.length) callback([]);
	else{
		var remaining = paths.slice(0); //deep copy
		var output = [];
		for(var i in paths){
			bilt.modules[paths[i]] = bilt.modules[paths[i]]||{value:{}, waiting:[]};
			var dep = bilt.modules[paths[i]];
			/* wait if not extant, not complete and not circular */
			var circular = depends(paths[i], self); //assuming self is a path
			if(dep.complete || circular) depReady(paths[i], dep.value);
			else dep.waiting.push(depReady)
		}
	}
	function depReady(dep, value){
		remaining.splice(remaining.indexOf(dep), 1);
		output[paths.indexOf(dep)] = value;
		if(!remaining.length) callback.apply(this, output);
	}
}

function amd(path, b, c){
    var deps = c?b:[];
    var factory = c||b;
    var depModules = [];
    for(var i in deps) depModules.push(amdModules[bilt.resolve(path, deps[i])]);
    if(factory) amdModules[path] = factory.apply(this, depModules);
}
amd.amd = {};
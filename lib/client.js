function load(path, deps, callback, e){
	bilt.waiting[path] = [];
	bilt.waitFor(deps, function(){
		var tag = document.createElement('script');
		tag.src = path;
		tag.onreadystatechange = function(){
			if(this.readyState == 'complete') complete();
		}
		tag.onload = complete;
		document.head.appendChild(tag); 
		
		function complete(){
		 	define(path, e?eval(e):null);
		   	if(!Object.keys(bilt.waiting).length && bilt.callback) bilt.callback();
		   	if(callback) callback(require(path));
		}
	});
}

function require(path){	
	var paths = path.split('!');
	var plugins = paths.length>1?paths.splice(0, paths.length-1):[];
	if(bilt.complete.indexOf(path) == -1){
	   if(bilt.factories.indexOf(path) != -1) bilt.modules[path] = bilt.modules[path].call(self);
    	for(var i in plugins){
    		var plugin = bilt.modules[plugins[i]];
    		if(plugin && plugin.init) bilt.modules[path] = plugin.init(bilt.modules[path]);
    	}
	   bilt.complete.push(path);
	}
	return bilt.modules[path];
}

function define(path, value, factory){
	if(factory) bilt.factories.push(path);
	bilt.modules[path] = value;
	if(bilt.waiting[path]) bilt.waiting[path].forEach(function(callback){
 		callback(path);
 	});
   	delete bilt.waiting[path];
}

function browser(v){
	return v;
}

function node(){}

function amd(path, b, c){
    var deps = c?b:[];
    var factory = c||b;
    var depModules = [];
    for(var i in deps) depModules.push(amdModules[bilt.resolve(path, deps[i])]);
    if(factory) amdModules[path] = factory.apply(this, depModules);
}
amd.amd = {};

var bilt = {
	modules : {},
	factories : [],
	complete : [],
	config : {},
	waiting : {},
	resolve : function(parent, path){
	   nodes = path.split('/');
	   if(nodes[0] != '.' && nodes[0] != '..') return path;
	   else{
	       out = parent.split('/');
	       out.pop();
	       for(var i in nodes){
	          if(nodes[i] == '.');
	          else if(nodes[i] == '..') out.pop();
	          else out.push(nodes[i])
	       }
	       return out.join('/');
	   }
	},
	waitFor : function(deps, callback){
		if(!deps.length) callback();
		else deps.forEach(function(dep){
			if(bilt.modules[dep]) depDone(dep);
			else{
				bilt.waiting[dep] = bilt.waiting[dep]||[];
				bilt.waiting[dep].push(depDone);
			}
		});
		function depDone(dep){
			deps.splice(deps.indexOf(dep), 1);
			if(!deps.length) callback();
		}
	},
	init : function(callback, paths){	
		var call = function(){
			callback.apply(this, paths.map(require));
		}
		if(Object.keys(bilt.waiting).length) bilt.callback = call;
		else call();
	}	
};
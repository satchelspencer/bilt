function load(path, deps, callback, e){
	thumos.waiting[path] = [];
	thumos.waitFor(deps, function(){
		var tag = document.createElement('script');
		tag.src = path;
		tag.onreadystatechange = function(){
			if(this.readyState == 'complete') complete();
		}
		tag.onload = complete;
		document.head.appendChild(tag); 
		
		function complete(){
		 	define(path, [], e?eval(e):null);
		   	if(!Object.keys(thumos.waiting).length && thumos.callback) thumos.callback();
		   	if(callback) callback(require(path));
		}
	});
}

function require(path){
	if(thumos.config[path]) path = thumos.config[path].url||thumos.config[path];
	return thumos.modules[path];
}

function define(path, deps, value){
	thumos.modules[path] = value;
	if(thumos.waiting[path]) thumos.waiting[path].forEach(function(callback){
 		callback(path);
 	});
   	delete thumos.waiting[path];
}

var thumos = {
	modules : {},
	config : {},
	waiting : {},
	waitFor : function(deps, callback){
		if(!deps.length) callback();
		else deps.forEach(function(dep){
			if(thumos.modules[dep]) depDone(dep);
			else{
				thumos.waiting[dep] = thumos.waiting[dep]||[];
				thumos.waiting[dep].push(depDone);
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
		if(Object.keys(thumos.waiting).length) thumos.callback = call;
		else call();
	}	
};
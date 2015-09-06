function load(path, callback, e){
	thumos.waiting[path] = 1;
	var tag = document.createElement('script');
	tag.src = path;
	tag.onreadystatechange = function(){
		if(this.readyState == 'complete') complete();
	}
	tag.onload = complete;
	document.head.appendChild(tag); 
	
	function complete(){
	 	if(e) define(path, eval(e));
	   	delete thumos.waiting[path];
	   	if(!thumos.waiting.length && thumos.callback) thumos.callback();
	   	if(callback) callback(require(path));
	}
}

function require(path){
	if(thumos.config[path]) path = thumos.config[path].url||thumos.config[path];
	return thumos.modules[path];
}

function define(path, value){
	thumos.modules[path] = value;
}

var thumos = {
	modules : {},
	config : {},
	waiting : {},
	init : function(callback, paths){
		var call = function(){
			callback.apply(this, paths.map(require));
		}
		if(thumos.waiting.length) thumos.callback = call;
		else call();
	}	
};
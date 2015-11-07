function browser(v){
	return v;
}
function node(){}

var bilt = {
	modules : {},
	config : {},
	waiting : {},
	complete : [],
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
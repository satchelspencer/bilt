var postcss = require('postcss');
var autoprefixer = require('autoprefixer-core');
var less = require('less');
var sqwish = require('sqwish');

module.exports = {
	text : function(text, callback){
		callback(null, 'define('+JSON.stringify(text)+')');
	},
	css : function(csstext, callback){
		less.render(csstext, function (e, css) {
			if(e) callback(e);
			else postcss([autoprefixer]).process(css).then(function(res){
				var css = sqwish.minify(res.css);
				callback(null, 'client((function(){var tag = document.createElement(\'style\');tag.type = \'text/css\';tag.innerHTML = '+JSON.stringify(css)+';document.getElementsByTagName(\'head\')[0].appendChild(tag);})())');
			});
		});
	}
};
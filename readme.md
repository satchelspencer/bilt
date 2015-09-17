# bilt
javascript module loader/build tool for briding the gap between server and client side
 - [`module format`](#module-definition)
 - [`node usage`](#node-usage)
 - [`configuration`](#configuration-options)
 - [`plugins`](#plugins)
 - [`environment`](#environmnent-exclusion)
 - [`dependencies`](#dependencies)

## module definition
each module is a javascript file with a call to `define` passing any javascript you like
~~~ Javascript
//mystring.js
define('im a string');
~~~
~~~ Javascript
//myfn.js
define(function(a){
  return a.toUpperCase();
});
~~~
modules can make calls to `require` to load eachother
~~~ Javascript
define(function(){
  //mymod.js
  var mystring = require('./mystring.js');
  var myfn = require('./myfn.js');
  console.log(myfn(mystring)); /* log: IM A STRING */
});
~~~
modules executing in the node environment may call `nodeRequire`
~~~ Javascript
define(function(path){
  //nodeModule.js
  var fs = nodeRequire('fs');
  return fs.statSync(path);
});
~~~
you can optionally include a config parameter in the define function, as an array of dependencies to include:
~~~ Javascript
define(['some_dep.js'], 'my module');
~~~
or as a config object with properties:
 - `deps` array of paths to be required
 - `paths` paths config (see [`configuration`](#configuration-options)) to be applied to module and all of its children

~~~ Javascript
define({
  paths : {
  	string : {
      source : './mystring.js',
  	}
  },
  deps : ['./mymod.js']
}function(path){
  var fs = require('string');
  return string+'!';
});
~~~


## node usage
create a new instace of built with a [`config object`](#configuration-options)
~~~ Javascript
var bilt = require('bilt');
var configObject = {};
var myProject = bilt(configObject);
~~~

~~~ Javascript
myProject.require(['mymod.js'], function(mymod){
  mymod(); /* log: IM A STRING */
});

myProject.build(['mymod.js'], function(mymod){
   mymod();
}, function(e, source){
  console.log('build complete', e, source);
})
~~~

## configuration options
passed as an object with *any* of the following properties:
 - `paths` object of path-specific options:
   - `source` path from which to load module.
   - `deps` array of paths the module is dependent on.
   - `export` specify what variable to export for standard javascript files.
   - `include` boolean (build only) to include in build or load externally.
   - `nodePath` specify separate path to require instead when executing in the node environment
   - `minify` bool if to minify just this module
   - *examples*
     
      ~~~ Javascript
      //source only
      'module-alias' : './module.js'
      ~~~
      ~~~ Javascript
       //with options
      'jquery' : {
         source : 'https://code.jquery.com/jquery-1.11.3.min.js',
        export : '$'
      }
      ~~~
 - `noMinify` boolean, determines if to use minification in build, if false all modules will be minified regardless of their settings
 

## plugins
plugins filter the module being required. plugins are prepended to a path in a require call like so: `path_to_plugin.js!my_module.js`. plugins are simply modules (an object) with *any* of the three optional properties defined as in this contrived example:
~~~ Javascript
//text.js
define({
  normalize : function(path){
  	return path+'.txt';
  },
  transform : function(raw, callback){
  	callback(null, 'define('+JSON.stringify(raw)+')');
  },
  init : function(value){
  	return 'the plugin:'+value;
  }
})
~~~
 - `normalize` a function that is passed the path of the module to be required and returns its new value, as desired
 - `transform` run always in node, takes in raw string from the loaded file and returns the javascript to be evaluated by bilt.
 - `init` run every time the module is required, modifies its value

example usage:
~~~ 
//mytext.txt
i'm the contents of a text file!
~~~
~~~ Javascript
define(function(){
 return require('text.js!mytext'); // "the plugin: i'm the contents of a text file!"
})
~~~

## environmnent exclusion
bilt offers two functions that allow the expression within them to only be executed onthe client or server.
 - `client(expression)` returns expression on client, null on server
 - `server(expression)` visa versa
this is especially useful in plugins with an init step that will only be run on the client to prevent client-only dependencies from being loaded during plugin normalization/transformation in the build step

## dependencies
 - [`async`](https://github.com/caolan/async) asyncronous control flow / functional library
 - [`underscore`](http://underscorejs.org/) synchrouous functional library
 - [`request`](https://github.com/request/request) for downloading external files with http(s)
 - [`uglify-js2`](https://github.com/mishoo/UglifyJS2) javascript minification
 - [`esprima`](http://esprima.org/) javascript parser
 - [`esprima-walk`](https://github.com/jrajav/esprima-walk) iterates over expressions in an esprima object
 - [`escodegen`](https://github.com/estools/escodegen) generates source from esprima object
 - [`parent-require`](https://github.com/jaredhanson/node-parent-require) nodrequires up the dependency tree

# bilt
javascript module loader/build tool for briding the gap between server and client side
 - [`api`](#API) 
 - [`defining modules`](#module-definition)
 - [`factory modules`](#factory-modules)
 - [`module dependencies`](#module-dependencies)
 - [`path resolution`](#path-resolution)
 - [`compatability`](#compatability)
 - [`configuration`](#configuration-options)
 - [`plugins`](#plugins)
 - [`environment`](#environmnent-exclusion)
 - [`dependencies`](#dependencies)

## API
create a new instace of built 
~~~ Javascript
var bilt = require('bilt');
var myProject = bilt();
~~~

`bilt.require(paths, callback)` require paths and callback in-order as arguments.
~~~ Javascript
myProject.require(['mymod.js'], function(mymod){
 
});
~~~

`bilt.build(paths, init, callback)` create a javascript file from required paths, and call back with source. init is called at runtime
~~~ Javascript
myProject.build(['mymod.js'], function(mymod){
   mymod();
}, function(e, source){
  console.log('build complete', e, source);
})
~~~

## module definition
each module is a javascript file with a call to `define` passing any javascript value you like: functions, literals, etc. unlike AMD, functions are not factory functions, and will not be evaluated as a function, [unless you want to...](#factory-modules)
~~~ Javascript
//define a function
define(function(a){
  return a.toUpperCase();
});
~~~
~~~ Javascript
//object
define({
  myProp : 9923,
  myFn : function(a){
    return a+3;
  }
});
~~~
~~~ Javascript
//not sure why you would do this
define('im a string');
~~~

## factory modules
you **can** make a module behave like a factory bu defining it with the `factory` function. It will be used to build the value of the module **once**. The value passed to `factory` must be a function.
~~~ Javascript
factory(function(){
  var something = require('something');
  return something+5;
});
~~~

## module dependencies 
modules can make calls to `require` to load eachother. all references to each module are shallow copies: a change to one reference to the module manifests across all its refernces. if this is not desired, consider using a function as a constructor to return new copies of the module.
~~~ Javascript
define(function(){
  var mystring = require('./mystring.js');
  var myfn = require('./myfn.js');
  console.log(myfn(mystring)); /* log: IM A STRING */
});
~~~
you can optionally include a config parameter in the define function, as an array of dependencies to include:
~~~ Javascript
define(['some_dep.js'], 'my module');
~~~
or as a [`config object:`](#configuration-options)

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

## path resoultion
all paths are relative to the script calling `require` or `build`. a path to a module is resolved with the following process:
 1. `paths rewrite` if the path has an entry in the [configuration options](#configuration-options) rewrite the path accordingly.
 2. `platform check` if a `nodePath` is specified and the module is to be executed in node, use it.
 3. `try open localy` check to see if the path exists locally.
 4. `try open remotely` check to see if it can be loaded from a remote server;
 5. `catch resolve again` if path is not found start at step `2` and try to re-resolve it. (this is required if references are multiple levels deep. not that you should do that). continue re-resolving untill it creates a circular reference.
 6. `look in node_modules` if all other resolution has failed, look for the file as if it were the path to a node module.
 7. `resoultion failed` path was not found, throw that error

## compatability
bilt can include non standard modules:
 - `raw javascript` using the `export` config option, built will evaluate the script in a closure and return the global variable as defined.
 - `node modules` in any bilt module, calls to `nodeRequire` will load the node module relative to the parent as `require` would in a commonJS module.
 - `AMD` using the `amd` config option, specify the name of the defined amd module to be returned. Note, this is not a replacement for requireJS and will not resolve paths or load dependencies of the amd module. It is intended for loading completed builds for an external dependancy.

## configuration options
passed as an object with *any* of the following properties:
 - `deps` array of paths the module is dependent on.
 - `export` specify what variable to export for standard javascript files.
 - `amd` string of amd module to export from file
 - `minify` bool if to minify just this module
 - `paths` object of mapping paths to their sources and/or extra options:
  - `source` path from which to load module.
  - `nodePath` specify separate path to require instead when executing in the node environment
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
 - `transform` run always in node, takes in raw string from the loaded file and returns the javascript to be evaluated by bilt.
 - `init` run every time the module is required, modifies its value. runs in the environment of the child module.

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
bilt offers two functions that allow the expression within them to only be executed in node or the browser.
 - `browser(expression)` returns expression on client, null on server
 - `node(expression)` visa versa
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
 - [`require-resolve`](https://github.com/qiu8310/require-resolve) finds the absolute path from a node module name

# bilt
javascript module loader/build tool for briding the gap between server and client side
 - [`module format`](#module-definition)
 - [`node usage`](#node-usage)
 - [`configuration`](#configuration-options)
 - [`plugins`](#plugins)

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
 - `noMinify` boolean, determines if to use minification in build
 

## plugins
plugins transform the input from a path before they are loaded or built as a module. They are specified by prepending a path with the name of the plugin and `!` **example:**
~~~ Javascript
define(function(){
  var text = require('text!./mypath.txt');
  console.log(text); //hooray!
});
~~~
mypath.txt:
~~~
hooray!
~~~
### built in plugins
 - `text` returns the value of the file as a string
 - `css` parses less, autoprefixes, minifies and append the styles to a page

### make your own plugins!
`bilt.addPlugins(object)` adds plugin(s). object keys are the plugin names, values are the plugins themselves. plugins are simply a function of the format `function(input, callback)`:
 - `input` the text value of the module to be transformed
 - `callback` to be called on completeion with the error and final value.

see the `text` plugin's source as an example:
~~~ Javascript
text : function(text, callback){
	callback(null, 'define('+JSON.stringify(text)+')');
}
~~~

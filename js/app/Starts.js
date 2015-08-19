window.CONFIG=require('./Config');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];

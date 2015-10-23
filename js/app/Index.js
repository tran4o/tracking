/*

	CUSTOMHACK IN jquery.fullPage.js
	TODO : FIX IN LATER RELEASES
	
	    function touchMoveHandler(event){
        	// HACK
        	if (this.__disable)
        		return;
        		
        ..
        function touchStartHandler(event) {
        	// HACK 
        	if (!$(event.target).is("h1")) {
        		this.__disable=1;
        		return;        	
        	}
        	this.__disable=0;
        ..
 * 
 */
//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./Gui');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
var STYLES=require('./Styles');
window.CONFIG = require('./Config');
var Utils = require('./Utils');
for (var e in Utils)
    window[e] = Utils[e];
//---------------------------------------------------------------------------------------------------------
function getSearchParameters() {
    var prmstr = window.location.search.substr(1);
    return prmstr != null && prmstr != "" ? transformToAssocArray(prmstr) : {};
}
function transformToAssocArray(prmstr) {
    var params = {};
    var prmarr = prmstr.split("&");
    for (var i = 0; i < prmarr.length; i++) {
        var tmparr = prmarr[i].split("=");
        params[tmparr[0]] = tmparr[1];
    }
    return params;
}
window.onOpen = function(id) {
	window.location.href="live.html?event="+encodeURIComponent(id);
}
var params = getSearchParameters();
//-----------------------------------------------
$.ajax({
    type: "GET",
    url: "../node/events",
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    success: function(data)
    {
    	
    	var tt=[];
    	for (var e in data.data) 
    	{	
    		var ev = data.data[e];
    		var track=JSON.parse(ev.track);        		
    		var extent = ol.proj.transformExtent( (new ol.geom.LineString(track)).getExtent() , 'EPSG:4326', 'EPSG:3857');
    		var h1t = "<div class='cnt' id='cnt"+e+"'>"+ev.code+"<div class='dur'>"+ev.startTime+"&nbsp;&nbsp;&nbsp;&nbsp;"+ev.endTime+"</div></div>";
    		var mdiv = $("#fullpage").append('<div class="section '+(e == 0 ? 'active' : '')+'" id="section'+e+'"><div class="pre" id="pre'+e+'"></div><div class="fre" id="fre'+e+'"><h1>'+h1t+'</h1></div><menu class="medium playbtn"><button class="play" onclick="onOpen(\''+ev.id+'\')"></button></menu></div>');
    		tt.push(ev.code);
			var raster = new ol.layer.Tile({source : new ol.source.OSM()/*,extent : extent*/ });
			var trackLayer = new ol.layer.Vector({
				  source: new ol.source.Vector(),
				  style : STYLES["track"]
				  //extent : extent
			});
			var map = new ol.Map({
				logo : false,
				interactions : ol.interaction.defaults({
					mouseWheelZoom : false
				}),
				target : 'pre' + e,
				layers : [ raster,trackLayer ],
				controls : ol.control.defaults(),
				view : new ol.View({
					center : [ 739218, 5906096 ],
					minZoom : 1,
					maxZoom : 17,
					zoom : 17
					//extent : extent
				})
			});
			//map.getView().fitExtent(extent, map.getSize());
			//-------
			var TRACK = new Track();
			TRACK.setBikeStartKM(parseFloat(ev.bikeStartKM));
	        TRACK.setRunStartKM(parseFloat(ev.runStartKM));
	        TRACK.setRoute(track);
	        window.GUI = new Object();
	        GUI.isShowSwim=true;
	        GUI.isShowBike=true;
	        GUI.isShowRun=true;
	        GUI.map=map;
	        TRACK.init();
	        trackLayer.getSource().addFeature(TRACK.feature);
	        //------------------------------------------------------
	        //pointer-events : none;
    	}
		$('#fullpage').fullpage({
			css3 : false,
			navigation : true,
			navigationPosition : 'right',
			navigationTooltips : tt
		});
   	 	$(".fre,h1").css("pointer-events","none");
        if(! /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
       } else {
    	   // MOBILE      	   
       }
	},
	failure : function(errMsg) {
		console.error("ERROR get data from backend " + errMsg)
	}
});
require('./Track');
require('./GUI');
require('./Participant');
window.CONFIG=require('./Config');
var STYLES=require('./Styles');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];

var draw;
var modify;
var select;

window.TRACK = new Track();
window.GUI = new Gui(
{
		track		: TRACK,
		initialZoom : 2
		//initialPos  : [lon,lat],
});

function errorRoute(err) {
	GUI.showError(err);
}

function initGUI() 
{
	if (GUI.is_init) {
		select.getFeatures().clear();
		return;
	}
	GUI.is_init=1;
	GUI.init({skipExtent:true});
	//-------------------------------------------------
	function store(forceClose,e) 
	{
		var feat;
		if (!GUI.getTrackLayer().getSource().getFeatures().length) {
			if (e && e.feature) {
				feat=e.feature;    
			} else {
				return null;
			}
		} else {
			feat = GUI.getTrackLayer().getSource().getFeatures()[0];
		}
		var trackData=feat.getGeometry().getCoordinates();
		if (forceClose) 
		{
			if (trackData[0][0] != trackData[trackData.length-1][0] || trackData[0][1] != trackData[trackData.length-1][1]) {
				trackData.push(trackData[0]);
				feat.getGeometry().setCoordinates(trackData);
			}
		}
		for (var i=0;i<trackData.length;i++)
			trackData[i]=ol.proj.transform(trackData[i], 'EPSG:3857','EPSG:4326');			
		$("#route_text_area").val(JSON.stringify(trackData));

		TRACK.setRoute(trackData);
		TRACK.updateFeature();
		GUI.trackLayer.getSource().clear();
		GUI.addTrackFeature();
		
		var str = (TRACK.getTrackLength()/1000.0)+" km";
		$("#route_info").val(str);
		return JSON.stringify(trackData);
	}
	//-------------------------------------------------
	select = new ol.interaction.Select({
		style: STYLES["trackselected"],
		layers: [GUI.trackLayer]
	});
	modify = new ol.interaction.Modify({
		features: select.getFeatures(),
		layers: [GUI.trackLayer]
	});
	//-------------------------------------------------
	draw = new ol.interaction.Draw({
	      source: GUI.trackLayer.getSource(),
	      type: "LineString"
	});
	draw.on('drawstart', function(e) {
		GUI.trackLayer.getSource().clear();
	});
	draw.on('drawend', function(e) {
		GUI.map.removeInteraction(draw);
		GUI.map.addInteraction(select);
		GUI.map.addInteraction(modify);
		store(false,e);
		// POST CLEANUP OF DOBLE FEATURE (on draw submit)
		setTimeout(function() 
		{
			var feats = GUI.trackLayer.getSource().getFeatures();
			var todel=[];
			for (var i in feats) {
				var feat = feats[i];
				if (!feat.track) {
					todel.push(feat);
				}
			}
			for (var i in todel) {
				var feat = todel[i];
				GUI.trackLayer.getSource().removeFeature(feat);
			}
		},0);
	});
	//-------------------------------------------------
	GUI.map.removeInteraction(select);
	GUI.map.removeInteraction(modify);
	GUI.map.addInteraction(draw);
	//-------------------------------------------------
	$("#button_erase").click(function(){
		GUI.trackLayer.getSource().clear();
		select.getFeatures().clear();
		GUI.map.removeInteraction(select);
		GUI.map.removeInteraction(modify);
		GUI.map.addInteraction(draw);
		store();
		GUI.getTrackLayer().getSource().clear()
		delete TRACK.feature;
	});
	$("#button_navigate").click(function(){
		TRACK.generateFromLocations(TRACK.getRoute(),function() {
			TRACK.updateFeature();
			store();
		},function(msg) {
			GUI.showError(msg);
		},true);			
	});
	$("#button_join").click(function() {
		store(true);
	});
	$("#button_submit").click(function() {
		var data = store();
		GUI.onEditSave(data);			
		$(".fw-container").css("display","block");
	});
	$("#button_cancel").click(function() {
		$("#map").css("display","none");
		$(".fw-container").css("display","block");
	});
}
//-------------------------------------------------
function mapEdit(id,json,valBikeStart,valRunStart,onSubmit) 
{		
	//console.log("ID : "+id+" | JSON : "+json);
	$(".fw-container").css("display","none");
	$("#map").css("display","block");
	initGUI();
	GUI.trackLayer.getSource().clear();
	var trackData;
	try {
		trackData = JSON.parse(json);
	} catch (e) {
		console.log("Unable to do mapEdit for "+json);
		trackData=[];
	}		
	TRACK.setRoute(trackData);
	TRACK.bikeStartKM=parseFloat(valBikeStart);
	TRACK.runStartKM=parseFloat(valRunStart);
	if (isNaN(TRACK.bikeStartKM))
		TRACK.bikeStartKM=3.86;
	if (isNaN(TRACK.runStartKM))
		TRACK.runStartKM=180.25+TRACK.bikeStartKM;
	if (json && json != "") 
	{
		$("#route_text_area").val(json);
		var str = (TRACK.getTrackLength()/1000.0)+" km";
		$("#route_info").val(str);
		GUI.addTrackFeature();
		GUI.zoomToTrack();
		GUI.map.removeInteraction(draw);
		GUI.map.addInteraction(select);
		GUI.map.addInteraction(modify);
	}		
	GUI.onEditSave = function(data) {
		$("#map").css("display","none");
		onSubmit(data);
	};
}

$(document).ready( function () 
{
	$(".mobile-show i").click(function() {
		$(".mobile-show").css("display","none"); 
		$(".fw-nav").css("height","auto"); 
	});
	//----------------------------------------
	window.EDITOR1 = new $.fn.dataTable.Editor( {
		ajax: '../participants',
		table: "#table-participants",
		idSrc: "id",
		fields: [ 
		    {
				label: "Start No",
				name: "startNo"
			},{
				label: "First name",
				name: "firstname"
			},{
				label: "Last name",
				name: "lastname"
			},{
				label: "Gender",
				name: "gender"
			},{
				label: "Nationality",
				name: "nationality"
			},{
				label: "Start group",
				name: "startGroup"
			},{
				label: "Club",
				name: "club"
			},{
				label: "Birth date",
				name: "birthDate",
			},{
				label: "Id",
				name: "id",
				type : "readonly"
			}			
		]
	} );

	window.EDITOR3 = new $.fn.dataTable.Editor( {
		ajax: '../events',
		table: "#table-events",
		idSrc: "id",
		fields: [{
					label: "Id",
					name: "id",
					type : "readonly"
				}, {
					label: "Start",
					name: "startTime"
				}, {
					label: "End",
					name: "endTime"
				}, {
					label: "Track",
					name: "track"
				}, {
					label: "Bike start km",
					name: "bikeStartKM"
				}, {
					label: "Run start km",
					name: "runStartKM"
				}]
	});

	
	var tableParticipants = $('#table-participants').DataTable( {
		dom: "Tfrtip",
		ajax: "../participants?mode=dtbl",
		columns: [
			{ data: "startNo",className : "dt-body-right" },
			{ data: "firstname" },
			{ data: "lastname" },
			{ data: "gender" },
			{ data: "nationality"},
			{ data: "startGroup" },
			{ data: "club"},
			{ data: "birthDate",className : "dt-body-right" }
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
				{ sExtends: "editor_create", editor: EDITOR1 },
				{ sExtends: "editor_edit",   editor: EDITOR1 },
				{ sExtends: "editor_remove", editor: EDITOR1 }
			]
		}
	} );	
	
	var tableEvents = $('#table-events').DataTable( {
		dom: "Tfrtip",
		ajax: "../events",
		columns: [
			{ data: "startTime" },
			{ data: "endTime" },
			{ 
				// track
				data: null,
				render: function ( data, type, row ) 
				{
					if (!data["track"])
						return "";
					var tpos = null;
					try {
						tpos=JSON.parse(data["track"]);
					} catch(e) {
					}
					var res;
					if (!tpos || !tpos.length)
						res="0 km";
					else {
						var tr = new Track();
						tr.setRoute(tpos);
						res = formatNumber2(tr.getTrackLength()/1000.0)+" km";
					}
					if (data["run-count"] && parseInt(data["run-count"]) > 1)
						res="<b>"+data["run-count"]+"x</b> "+res;
					if (data["begin-time"] && data["end-time"])
						res=data["begin-time"]+"-"+data["end-time"]+" ("+res+")";
					return res;
				} 
			},
			{ data: "bikeStartKM",className : "dt-body-right" },
			{ data: "runStartKM",className : "dt-body-right" }
		],
		tableTools: {
			sRowSelect: "os",
			aButtons: [
			    { sExtends: "editor_create", editor : EDITOR3 },
				{ sExtends: "editor_edit",   fnClick : function () {
					EDITOR3
		            .title( 'Edit event configuration' )
		            .buttons( [
                               { label: 'Save', fn: function() { this.submit(); } },
                               { label: 'Map', fn: function() {
                            	   var dt = tableEvents.rows(".selected").data()[0];
                            	   var that=this;
                            	   mapEdit(dt.id,$("#DTE_Field_track").val(),$("#DTE_Field_bikeStartKM").val(),$("#DTE_Field_runStartKM").val(),function(data) {
                            		   $("#DTE_Field_track").val(data);
                            	   });
                                } },
                                { label: 'Starts', fn: function() {
                                	var eid = $("#DTE_Field_id").val();
                                	if (!eid || !eid.length) {
                                		alert("Only on saved event possible!");
                                		return;
                                	}
                                	$(".fw-container").css("display","none");
                                	$("#starts").css("display","block");
                                	
                                	var EDITOR2 = new $.fn.dataTable.Editor( {
                                		ajax: '../starts',
                                		table: "#table-starts",
                                		idSrc: "id",
                                		fields: [{
                                					label: "Id",
                                					name: "id",
                                					type : "readonly"
                                				}, {
                                					label: "From No",
                                					name: "fromStartNo"
                                				}, {
                                					label: "To No",
                                					name: "toStartNo"
                                				}, {
                                					label: "Start Time",
                                					name: "startTime"
                                				}]
                                	} );
                                	
                                	var tableStarts = $('#table-starts').DataTable( {
                                		dom: "Tfrtip",
                                		ajax: "../starts/"+eid,
                                		columns: [
                                			{ data: "fromStartNo",className : "dt-body-right" },
                                			{ data: "toStartNo",className : "dt-body-right" },
                                			{ data: "startTime",className : "dt-body-right" }
                                		],
                                		tableTools: {
                                			sRowSelect: "os",
                                			aButtons: [
                                				{ sExtends: "editor_create", editor: EDITOR2 },
                                				{ sExtends: "editor_edit",   editor: EDITOR2 },
                                				{ sExtends: "editor_remove", editor: EDITOR2 }
                                           ]
                                		}
                                	} );
                                } }
                             ] )
		                    .edit( tableEvents.row( '.selected' ).node() );
				     } 
				},
				{ sExtends: "editor_remove", editor: EDITOR3 }
           ]
		}
	} );
	
	//-----------------------------------------------
	
	/*
	$("#nav1").click(function() {
		$("#nav1").addClass("active");
		$("#nav2").removeClass("active");
		$("#tab1").css("height","auto");
		$("#tab2").css("height","0");
	});
	$("#nav2").click(function() {
		$("#nav2").addClass("active");
		$("#nav1").removeClass("active");
		$("#tab2").css("height","auto");
		$("#tab1").css("height","0");
	});
	*/
	//-----------------------------------------------
});

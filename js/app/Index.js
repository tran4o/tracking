//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./GUI');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
require('./BackendStream');
require('./../nodejs/StreamData');
window.CONFIG=require('./Config');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];
//---------------------------------------------------------------------------------------------------------
function getSearchParameters() {
    var prmstr = window.location.search.substr(1);
    return prmstr != null && prmstr != "" ? transformToAssocArray(prmstr) : {};
}
function transformToAssocArray( prmstr ) {
  var params = {};
  var prmarr = prmstr.split("&");
  for ( var i = 0; i < prmarr.length; i++) {
      var tmparr = prmarr[i].split("=");
      params[tmparr[0]] = tmparr[1];
  }
  return params;
}
var params = getSearchParameters();
//-----------------------------------------------
if (params["debug"] && params["debug"] != "0") 
{
	// DEBUG MODE CONFIGURATIOn
	CONFIG.timeouts.animationFrame=4; // 4 sec
}
//-----------------------------------------------
var tableFavorites=null;
var tableParticipants=null;
var tableRank=null;

function showMap() {
	$("#left_pane").addClass('hide');
	$("#map").removeClass('col-sm-6').removeClass('col-md-8').removeClass('hidden-xs').addClass('col-sm-12');
	$(window).resize();
	if (GUI.map)
		GUI.map.updateSize();
}
function showLeftPane() {
	$("#map").addClass('col-sm-6 col-md-8 hidden-xs').removeClass('col-sm-12');
	$("#left_pane").removeClass('hide');
	$(window).resize();
	if (GUI.map)
		GUI.map.updateSize();
}

function isTabVisible(tabname) {
	if ($("#left_pane").hasClass("hide"))
		return false;			
	if (tabname.indexOf('#') == -1) {
		tabname = '#' + tabname;
	}
	return !($(tabname).hasClass('hide'));
}
function showTab( tabname ) {
	$('#tabcont').find('div[role="tabpanel"]').addClass('hide');
	if (tabname.indexOf('#') == -1) {
		tabname = '#' + tabname;
	}
	$(tabname).removeClass('hide');
}

function showParticipants() {
	var arr = PARTICIPANTS;
	var res = [];
	for (var i in arr) 
	{
		var part = arr[i];
		res.push({name : part.code,bib : part.startPos,gender : part.gender,country : part.country,ageGroup : part.ageGroup,age : part.age,"overall-rank" : part.getOverallRank(),"gender-rank" : part.getGenderRank(),"group-rank" : part.getGroupRank(), "occupation" : ""});
	}
	showLeftPane();
	showTab("part");
	if (!tableParticipants)
	{
        tableParticipants = $('#table-participants').DataTable( {
        	"destroy" : true,
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[2,'asc']],
			//ajax: CONFIG.server.prefix+"rest/participant/",
			data : function()  {
				return PARTICIPANTS;
			},	
			columns: [
				{ 
					//follow
					className : "dt-body-center", 
					data: null,
					render: function ( data, type, row ) 
					{
						if (data.follow == 1)
							return "<div class='invisible'>1</div><img onclick='MAKEFAV(\""+data.id+"\")' src='img/favorite.png' class='table-favorite-add'/>";
						return "<div class='invisible'>0</div><img onclick='MAKEFAV(\""+data.id+"\")' src='img/favorite-add.png' class='table-favorite-add'/>";
					} 
							
				},
				{ data: "name" },
				{ data: "bib",className : "dt-body-center" },
				{ data: "gender",className : "dt-body-center" },
				{ 
					className : "dt-body-center", 
					data: null,
					render: function ( data, type, row ) 
					{
						if (!data.country)
							return "";
						return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
					} 					
				},
				{ 
					// age + GROUP
					data: null,
                    className : "dt-body-right",
					render: function ( data, type, row ) 
					{
						return data.age;
					}

				}
	
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
	} else {
		$("#table-participants").resize();  
	}
}

function showFavs() 
{
	showLeftPane();
	showTab("favs");
	if (!tableFavorites) 
	{
		var arr = PARTICIPANTS.filter(function(v){ return v.isFavorite; });
		var res = [];
		for (var i in arr) 
		{
			var part = arr[i];
			res.push({name : part.code,bib : part.startPos,gender : part.gender,country : part.country,ageGroup : part.ageGroup,age : part.age});
		}
		tableFavorites = $('#table-favorites').DataTable( {
			"destroy" : true,
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[1,'asc']],
			data : res,
			columns: [
				{ data: "name" },
				{ data: "bib",className : "dt-body-center" },
                { data: "gender",className : "dt-body-center" },
                {
                    className : "dt-body-center",
                    data: null,
					render: function ( data, type, row ) 
					{
						if (!data.country)
							return "";
						return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
					} 
				},
				{ 
					// age + GROUP
					data: null,
					render: function ( data, type, row ) 
					{
						return data.age;
					} 
					,className : "dt-body-right"

				}
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
		$('#table-favorites').find('tbody').on( 'click', 'tr', function (e) {
			if (tableFavorites.row( this ).data()) {
				GUI.setSelectedParticipant1(tableFavorites.row( this ).data().code,true);
				GUI.setSelectedParticipant2(null);
			}
		} );
	} else {
		$("#table-favorites").resize();  
	}
}

function refreshTables()  {
	if (tableRank) 
	{
		var arr = PARTICIPANTS;
		var res = [];
		for (var i in arr) 
		{
			var part = arr[i];
			res.push({id : part.id,follow : part.isFavorite,name : part.code,bib : part.startPos,gender : part.gender,country : part.country,ageGroup : part.ageGroup,age : part.age,"overall-rank" : part.getOverallRank(),"gender-rank" : part.getGenderRank(),"group-rank" : part.getGroupRank(), "occupation" : ""});
		}
		tableRank.fnClearTable();
		tableRank.fnAddData(res);
		tableRank.fnDraw();
	}
}


window.MAKEFAV = function(id) 
{
	for (var i in TRACK.participants) 
	{
		var p = TRACK.participants[i];
		if (p.id == id) 
		{
			if (p.isFavorite) {
				p.isFavorite=false;
				localStorage.setItem("favorite-"+p.id,"0");
				refreshTables();
				break;
			} else {
				p.isFavorite=true;
				localStorage.setItem("favorite-"+p.id,"1");
				refreshTables();
				break;
			}
		}
	}
};

function showRank() 
{
	showLeftPane();
	showTab("rank");
	if (!tableRank) 
	{
		var arr = PARTICIPANTS;
		var res = [];
		for (var i in arr) 
		{
			var part = arr[i];
			res.push({id : part.id,follow : part.isFavorite,name : part.code,bib : part.startPos,gender : part.gender,country : part.country,ageGroup : part.ageGroup,age : part.age,"overall-rank" : part.getOverallRank(),"gender-rank" : part.getGenderRank(),"group-rank" : part.getGroupRank(), "occupation" : ""});
		}
		tableRank = $('#table-ranking').DataTable( {
			"iDisplayLength" : 50,
			"bAutoWidth": false,
			"aaSorting": [[1,'asc']],
			//ajax: "script/participants-example.json",
			data : res,
			columns: [
				{ 
					//follow
					className : "dt-body-center", 
					data: null,
					render: function ( data, type, row ) 
					{
						if (data.follow == 1)
							return "<div class='invisible'>1</div><img onclick='MAKEFAV(\""+data.id+"\")' src='img/favorite.png' class='table-favorite-add'/>";
						return "<div class='invisible'>0</div><img onclick='MAKEFAV(\""+data.id+"\")' src='img/favorite-add.png' class='table-favorite-add'/>";
					} 
				},

				{ data: "name" },
				{ data: "overall-rank",className : "dt-body-center" },
				{ data: "group-rank",className : "dt-body-center" },
				{ data: "gender-rank",className : "dt-body-center" },
				{ data: "bib",className : "dt-body-center" },
				{ data: "gender",className : "dt-body-center" },
                {
                    className : "dt-body-center",
                    data: null,
                    render: function ( data, type, row )
                    {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">'+data.country+'</div><flag-icon key="'+data.country+'" width="42"></flag-icon>';
                    }
                },
				{ 
					// age + GROUP
					data: null,
					render: function ( data, type, row ) 
					{
						return data.age;
					} 
				},
				{ data: "occupation",className : "dt-body-center" }
			],
			tableTools: {
				sRowSelect: "os",
				aButtons: [			           
	           ]
			}
		} );
	} else {
		$("#table-ranking").resize();  
	}
}

function showDetails() {
	showLeftPane();
	showTab("dtls");
}

//--------------------------------------------------------------------------
window.TRACK = new Track();
window.GUI = new Gui({ track : TRACK });
window.PARTICIPANTS=[];
function errorRoute(err) {
	GUI.showError(err);
}
//--------------------------------------------------------------------------
function initGUI() 
{
    // add all the static HotSpots
    var dynamicTrackHotspots = [];
	for (var k=0;k<HOTSPOTS.length;k++)	{
		var hotspotData = HOTSPOTS[k];
		var hotspot = new HotSpot(HOTSPOTS[k]);
		if (hotspotData.point) {
			// this is a static hotspot - just a fixed point
			hotspot.init(HOTSPOTS[k].point);
		} else {
			// this is a dynamic HotSpot - depending on the Track
			dynamicTrackHotspots.push(hotspot)
		}
    }
	TRACK.newHotSpots(dynamicTrackHotspots);
}
//--------------------------------------------------------------------------
$(document).ready( function () 
{
	if (Utils.mobileAndTabletCheck())
		$("body").addClass("mobile");
	//--------------------------------------------------------------------------
	var baseurl = (window.location.host.indexOf("localhost") == 0 || window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/" : "node/"; 
	//--------------------------------------------------------------------------
	$.getJSON(baseurl+"event",function(data) 
	{
		var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
		var camc = 0;
		TRACK.setBikeStartKM(data.bikeStartKM);
		TRACK.setRunStartKM(data.runStartKM);
		TRACK.setRoute(data.route);
		CONFIG.times={begin : data.times.startTime+delay, end : data.times.endTime+delay };
		GUI.init({skipExtent:true});
		function processEntry(pdata,isCam) {
			var part; 
			if (isCam)
				part=TRACK.newMovingCam(pdata.id,pdata.deviceId,pdata.code,camc++);
			else
				part=TRACK.newParticipant(pdata.id,pdata.deviceId,pdata.code);
			part.setColor(pdata.color);
			part.setAgeGroup(pdata.ageGroup);
			part.setAge(pdata.age);
			part.setCountry(pdata.country);
			part.setStartPos(pdata.startPos);
			part.setGender(pdata.gender);
			part.setIcon(pdata.icon);
			part.setImage(pdata.image);
			if (isCam || localStorage.getItem("favorite-"+part.id) == 1)
				part.setIsFavorite(true);
			if (!isCam) 
				PARTICIPANTS.push(part);
		}
		for (var i in data.participants) 
			processEntry(data.participants[i],false);
		for (var i in data.cams) 
			processEntry(data.cams[i],true);
		

		// FIXME ---------------------------------------------------------------------------------- 
		/*function doHTTP(url,json,onReqDone) 
		{
		    if (json.length) 
		    {
                $.ajax({
                    type: "POST",
                    url: url,
                    data: JSON.stringify(json),
                    contentType: "application/json; charset=utf-8",
                    dataType: "json",
                    success: function(data){
                    	onReqDone(data);
                    },
                    failure: function(errMsg) {
                        console.error("ERROR get data from backend "+errMsg)
                    }
                });
		    }                		
		}
		var stream = new StreamData();
		stream.start(TRACK,function() {return true;},10,doHTTP); // 10 sec ping int.*/
		// FIXME ---------------------------------------------------------------------------------- 
		var stream = new BackendStream();
		stream.start(TRACK); 									

		initGUI();
	}).fail(function() {
    	console.error("Error get event configuration from backend!");
	});
	//--------------------------------------------------------------------------
	$("#button_swim").css("background-color",CONFIG.appearance.trackColorSwim).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowSwim=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowSwim=false;
		}
		GUI.redraw();
	});

	$("#button_bike").css("background-color",CONFIG.appearance.trackColorBike).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowBike=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowBike=false;
		}
		GUI.redraw();
	});

	$("#button_run").css("background-color",CONFIG.appearance.trackColorRun).click(function() {
		if ($(this).hasClass("inactive"))
		{
			$(this).removeClass("inactive");
			GUI.isShowRun=true;
		} else {
			$(this).addClass("inactive");
			GUI.isShowRun=false;
		}
		GUI.redraw();
	});

	$("#button_participants").click(function() {
		if (isTabVisible("part"))
			showMap();
		else
			showRank();
	});

	$("#button_favorites").click(function() {
		if (isTabVisible("favs"))
			showMap();
		else
			showFavs();
	});

	$("#button_rank").click(function() {
		if (isTabVisible("rank"))
			showMap();
		else
			showParticipants();
	});

	$("#tabcont").find(".close").click(function() {
		showMap();
	});


	$("#link_partners, #link_legalNotice, #button_liveStream").click(function() {
		// TODO Rumen - don't like it, will have to fix it later
		var $toClose = $("._contVisible");
		var $toOpen = $("#" + $(this).data("open"));
		var isLiveStreamClose = $toClose.is("#liveStream");
		var isLiveStreamOpen = $toOpen.is("#liveStream");

		var self = this;
		function open() {
			$toClose.removeClass("_contVisible");

			if ($toClose.is($toOpen))
				return;

			if (isLiveStreamOpen) {
				var isShown = GUI.toggleLiveStream();
				$toOpen.toggleClass("_contVisible", isShown);
			} else {
				$toOpen.addClass("_contVisible");
				$toOpen.slideDown();
			}
		}

		if ($toClose.length) {
			if (isLiveStreamClose) {
				GUI.toggleLiveStream(open);
			} else {
				$toClose.slideUp(400, open);
			}
		} else {
			open();
		}
	});

});


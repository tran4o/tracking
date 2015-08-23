require('./../app/Track');
require('./StreamData');
var moment = require('moment');
var requestJSON = require('request-json');
var BinarySearchTree = require('binary-search-tree').BinarySearchTree;
var Utils = require('./../app/Utils');
var CONFIG = require('./../app/Config');
var Config = require('./Config');
var Simulator = require('./Simulator');
var request = require('request-json');
var fs = require('fs');
var path = require('path');
//------------------------------------------------------------------
function doHTTP(url,json,onReqDone) 
{
    if (json.length) 
    {
		var client = requestJSON.createClient("http://liverortung.de");
		var tt = [];
		for (var i in json) {
			tt[i]={imei:json[i].imei,from:json[i].from,to:json[i].to};
			tt[i].toSTR=moment.utc(new Date(tt[i].to)).format("DD.MM.YYYY HH:mm:ss.SS");
			tt[i].fromSTR=moment.utc(new Date(tt[i].from)).format("DD.MM.YYYY HH:mm:ss.SS");
		}
		//console.log("POSTING "+url+" | "+JSON.stringify(tt));
		function postDone(err, res, body) 
		{
			if (err)
				console.log("Error geting server live data "+err);
			else { 
				//console.log("REQDONE "+url+" | "+JSON.stringify(body));
				onReqDone(body);
				// collect 
				generateIntermediate();
			}
		}
		client.post(url, json, postDone);
    }                		
}
function getAge(birthDate) {
    var today = new Date();
    var age = today.getFullYear() - birthDate.getFullYear();
    var m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}
//--------------------------------------------------------------------------
var startTime = (new Date()).getTime() - 10*60*1000;	// 10 minutes before
//--------------------------------------------------------------------------
function inRaceChecker() {
	var event = Config.getCurrentEvent();
	if (!event)
		return false;
	return true;
}
//--------------------------------------------------------------------------
// COPY... 
CONFIG.math.displayDelay = Config.interpolation.displayDelay;
//--------------------------------------------------------------------------
// EVERY 5 seconds interpolation and ranking calculations
//--------------------------------------------------------------------------
function addState(event,imei,state) 
{
	if (!event.stateStorage)
		event.stateStorage={};
	if (!event.stateStorage[imei])
		event.stateStorage[imei]=new BinarySearchTree();
	event.stateStorage[imei].insert(state.getTimestamp(),state);	
	if (event.stateStorage[imei].data.length > 3000)
		event.stateStorage[imei].delete(event.stateStorage[imei].getMinKey());
}
//--------------------------------------------------------------------------
var oldEvent = null;
var oldUpdateCount = Config.updateCount;
setInterval(function() 
{
	var event = Config.getCurrentOrNextEvent();
	if (!event)
		return;	
	if (oldEvent != event || oldUpdateCount != Config.updateCount) 
	{
		console.log("Reset tracking event to "+event.code+" | OLD="+(oldEvent ? oldEvent.code : ""));
		if (oldEvent) {
			oldEvent.stream.isStopped=true;
			delete oldEvent.trackedParticipants;
			delete oldEvent.partLookupByIMEI;
		}
		oldEvent=event;
		oldUpdateCount=Config.updateCount;
		if (event != null)
		{
			event.trackedParticipants=[];
			event.partLookupByIMEI={};
			event.TRACK = new Track();
			event.TRACK.setBikeStartKM(event.bikeStartKM);
			event.TRACK.setRunStartKM(event.runStartKM);
			event.TRACK.setRoute(event.trackData);
			event.TRACK.init();
			console.log("Starting tracking engine for track "+event.code+" with length "+Utils.formatNumber2(event.TRACK.getTrackLength()/1000.0)+" km. ("+Utils.formatNumber2(event.bikeStartKM)+" + "+Utils.formatNumber2(event.runStartKM-event.bikeStartKM)+" + "+Utils.formatNumber2(event.TRACK.getTrackLength()/1000.0-event.runStartKM)+") km");
			//----------------------------------------------------------------------------------------------------------------------------------
			var tt=0;
			for (var i in Config.participants) 
			{
				var p = Config.participants[i];
				var id = p.idParticipant;
				if (Config.assignments[id] && Config.assignments[id].length) 
				{
					var devId = Config.assignments[id];
					var part = event.TRACK.newParticipant(id,devId,p.firstname+" "+p.lastname);
					part.setColor(Utils.rainbow(Object.keys(Config.assignments).length,event.trackedParticipants.length));
					part.setAgeGroup(p.ageGroup);
					part.setAge(2015-parseInt(p.birthYear));	/* TODO!!! */
					part.setCountry(p.nationality);
					part.setStartPos(parseInt(p.startNo));
					part.setGender(p.sex);
					var apath = path.join(__dirname, "../../img/data/"+id+".jpg");
					if (fs.existsSync(apath)) {
						part.setIcon("img/data/"+id+".jpg");
						part.setImage("img/data/"+id+".jpg");
					} else {
						part.setIcon("img/noimage.png");
						part.setImage("img/noimage.png");			
					}
					event.trackedParticipants.push(part);
					event.partLookupByIMEI[devId]=part;
					//-----------------------------
					part.setStartTime(Config.getStartTimeFromStartPos(part.getStartPos()));
					if (Config.simulation.singleParticipant)
						break;
					
					// TEST ONLY
					tt++;
					if (tt == 3)
						break;
				}
			}
			if (Config.simulation.enabled) 
				Simulator.startSimulation(event.TRACK,Config.simulation.speedCoef);	
			if (!Config.simulation.singleParticipant)
			for (var i in Config.cams) 
			{
				var cam = Config.cams[i];
				var part = event.TRACK.newParticipant(cam.code,cam.deviceId,cam.name);
				part.setAgeGroup("-");
				part.setGender("-");
				part.setCountry("Germany");
				part.setIcon(cam.icon);
				part.setImage(cam.icon);
				part.setStartPos(0);
				part.setAge(0);
				event.trackedParticipants.push(part);
				event.partLookupByIMEI[devId]=part;
				part.setStartTime(1); /* placeholder not 0 */
				part.__cam=1;
			}
			console.log(event.trackedParticipants.length+" tracked participants found");
			//---------------------------------------------------------------------
			event.stream = new StreamData();
			event.stream.start(event.TRACK,inRaceChecker,Config.network.pingInterval,doHTTP);
		}
	}
},5000);
//-------------------------------------------------------------------------
function generateIntermediate() 
{
	var event = Config.getCurrentOrNextEvent();
	if (!event)
		return;

	// NOT ACTIVE EVENT?
	var cevent = Config.getCurrentEvent();
	if (cevent == null || event != cevent) {
		return;
	}
	var ctime = (new Date()).getTime() - Config.interpolation.displayDelay*1000;
	var overAllRank={};
	var genderRank={};
	var groupRank={};
	var arr=[];
	var val=[];
	for (var i in event.trackedParticipants) 
	{ 
		var part = event.trackedParticipants[i];
		//var elp = part.min(ctime,"elapsed")
		var elp = part.avg(ctime,"elapsed")
		part.__elapsed=elp;
		if (elp == null) {
			//console.log("SKIPP BECAUSE OF ELP NULL "+i);
			continue;
		}
		arr.push(i);
		var spd = part.avg(ctime,"speed");
		if (spd == 0)
			val.push(999999999.0);
		else {
			var moredist = (1.0-elp)*event.TRACK.getTrackLength();
			val.push(moredist/spd);
		}
	}
	
	
	console.log(arr.length+" | GENERATE INTERMEDIATE : "+Utils.formatDateTimeSec(new Date(ctime)));
	//console.log(val);
	arr.sort(function(a, b){
		return val[a]-val[b];
	});
	var tmp={};
	var tmp1={};
	var k=0;
	for (var i in arr) 
	{
		var part = event.trackedParticipants[arr[i]];
		var ageGroup = part.getAgeGroup();
		var gender = part.getGender();
		if (!tmp[ageGroup])
			tmp[ageGroup]=[];
		tmp[ageGroup].push(part);
		if (!tmp1[gender])
			tmp1[gender]=[];
		tmp1[gender].push(part);
		overAllRank[part.deviceId]=k+1;
		groupRank[part.deviceId]=tmp[ageGroup].length;
		genderRank[part.deviceId]=tmp1[gender].length;
		k++;
	}
	for (var i in arr) 
	{
		var part = event.trackedParticipants[arr[i]];		
		var ts = new ParticipantState();
		ts.setSpeed(part.avg(ctime,"speed"));
		ts.setElapsed(part.__elapsed);
		ts.setFreq(parseInt(part.avg(ctime,"freq")));
		ts.setAcceleration(part.avg(ctime,"acceleration"));
		ts.setAlt(parseInt(part.avg(ctime,"alt")));
		ts.setGps(part.min(ctime,"gps"));
		ts.setIsSOS(part.states[part.states.length-1].getIsSOS());
		ts.setTimestamp(ctime);		
		ts.setOverallRank(overAllRank[part.deviceId]);
		ts.setGenderRank(genderRank[part.deviceId]);
		ts.setGroupRank(groupRank[part.deviceId]);
		ts.debugInfo = part.min(ctime,"debugInfo");
		//console.log("STATE DEBUG INFO : "+JSON.stringify(ts.debugInfo));
		addState(event,part.deviceId,ts);
	}
	var dinfo=[];
	for (var i in arr) {
		var part = event.trackedParticipants[i];		
		dinfo.push(Math.round(part.__elapsed*100*100)/100.0);
	}
	console.log(">>>>>>>>> "+JSON.stringify(dinfo));
}
//-------------------------------------------------------------------------
// from inclusive , to exclusive
exports.queryData = function(imei,from,to) 
{
	var event = Config.getCurrentEvent();
	if (!event)
		return [];
	var res=[];
	if (event.stateStorage && event.stateStorage[imei]) 
	{
		var qry = event.stateStorage[imei].betweenBounds({ $gte: from, $lt: to });
		for (var j in qry) 
		{
			var state = qry[j];
			res.push({
				imei : imei,
				speed : state.speed,
				elapsed : state.elapsed,
				timestamp : state.timestamp,		// UTC
				gps : state.gps,
				freq : state.freq,
				isSOS : state.isSOS,
				acceleration : state.acceleration,
				alt : state.alt,
				overallRank : state.overallRank,
				genderRank : state.genderRank,
				groupRank : state.groupRank,
				debugInfo : state.debugInfo
			});
		}
	}
	res.sort(function(a, b){
		return a.timestamp - b.timestamp;
	});
	return res;
}
//--------------------------------------------------------------------------

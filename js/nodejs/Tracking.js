var pg = require('pg');
var conString = "postgres://VISIONR:plan4vision@localhost/TRACKING";

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
var client = new pg.Client(conString);

var DOLOG = false;

client.connect(function(err) 
{
  if(err) {
	  return console.error('could not connect to postgres', err);
  }	 
  //------------------------------------------------------------------
  function doHTTP(url,json,onReqDone) 
  {
      if (json.length) 
      {
  		var cc = requestJSON.createClient("http://liverortung.de");
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
  		cc.post(url, json, postDone);
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
  var oldEvent = null;
  var oldUpdateCount = Config.updateCount;
  //--------------------------------------------------------------------------
  // EVERY 5 seconds interpolation and ranking calculations
  //--------------------------------------------------------------------------
  var commitQueue = [];
  var handleError = function(err) {
      // no error occurred, continue with the request
      if(!err) return false;
      console.error("ERROR PG HANDLER : "+err);
  };
  
  var loading=2;
  client.query("SET AUTOCOMMIT = ON",function(err,result) 
  {
      if(handleError(err)) 
    	  return;
      console.log("\nTracking DB connection initialized..");
      var arrRecalc=[];
      var arrSimulate=[];
      //------------------------------------------------
      function doSimulate() {
    	  if (arrSimulate.length) 
    	  {
    		var event = arrSimulate.shift();
			simulateEvent(event,doSimulate);
    	  } else {
    		  //process.exit();
    		  loading--;
    	  }
      }
      //------------------------------------------------
      function doRecalc() 
      {
    	  if (arrRecalc.length) 
    	  {
    		var event = arrRecalc.shift();
			recalculateEvent(event,doRecalc);
    	  } else {
    		  loading--;
    	  }
      }
      process.argv.forEach(function (val, index, array) 
      {
    	  if (array[index] == "simulate") {
  			for (var i in Config.events) 
			{
				var event = Config.events[i];
				if (array[index+1] == event.code) {
					arrSimulate.push(event);
				}
			}
    	  } else if (array[index] == "recalc") {
    			for (var i in Config.events) 
    			{
    				var event = Config.events[i];
    				if (!array[index+1] || array[index+1] == "all" || array[index+1] == event.code) {
    					arrRecalc.push(event);
    				}
    			}
    	  }
      });
      doSimulate();
      doRecalc();
      //----------------------------------------
      function checkBoot() {
    	  if (loading || commitQueue.length) {
    		  setTimeout(checkBoot,100);
    		  return;
    	  }
    	  console.log("Application boot done!");
    	  // main event loop for updating data
          /*setInterval(function() 
          {
        		  	var event = Config.getCurrentOrNextEvent();
        		  	if (!event)
        		  		return;	
        		  	
          },5000);*/

      }
      checkBoot();      
      //-------------------------------------------
      var msgflg=false;
      function commitOne() 
      {
    	  if (oldEvent && commitQueue.length)
    	  {
    		  msgflg=true;
    		  var d = commitQueue.shift();    		  
    		  client.query("INSERT INTO calculated_states (id,partId,eventId,t,imei,elapsed,acceleration,altitute,isSOS,overallRank,genderRank,groupRank,data) VALUES (NEXTVAL('cid'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [d.partId,d.eventId,d.timestamp,d.imei,d.elapsed,d.acceleration,d.alt,d.isSOS,d.overallRank,d.genderRank,d.groupRank,d], function(err, result) 
    		  {
    		      // handle an error from the query
    		      if(handleError(err)) 
    		    	  return;
    		      setTimeout(commitOne,0);
    		  });
    	  } else {    		
    		  if (msgflg) {
    			  console.log("DB COMMIT QUEUE FINISHED!");
    			  msgflg=false;
    		  }
    		  setTimeout(commitOne,100);    		  
    	  }
      }
      commitOne();
  });
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
  	commitQueue.push(state);
  }
  //-------------------------------------------------------------------------- 
  function prepareEvent(event,force) 
  {
	  if (force || !event.trackedParticipants) {
		    event.trackedParticipants=[];
			event.partLookupByIMEI={};
			event.TRACK = new Track();
			event.TRACK.setBikeStartKM(event.bikeStartKM);
			event.TRACK.setRunStartKM(event.runStartKM);
			event.TRACK.setRoute(event.trackData);
			event.TRACK.init();
			//----------------------------------------------------------------------------------------------------------------------------------
			var tt=0;
			for (var i in event.participants) 
			{
				var p = event.participants[i];
				var id = p.idParticipant;
				if (event.assignments[id] && event.assignments[id].length) 
				{
					var devId = event.assignments[id];
					var part = event.TRACK.newParticipant(id,devId,p.firstname+" "+p.lastname);
					part.setColor(Utils.rainbow(Object.keys(event.assignments).length,event.trackedParticipants.length));
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
					part.__startTime = event.startTime.getTime();							//START TIME
					//-----------------------------
					part.setStartTime(Config.getStartTimeFromStartPos(part.getStartPos()));
				}
			}
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
				part.__startTime = event.startTime.getTime();	
				part.setStartTime(1); /* placeholder not 0 */
				part.__cam=1;
			}	  
	  }
  }
  exports.prepareEvent=prepareEvent;
  
  //onDoneCallback == null > iterate...
  function doFetchData(event,onDoneCallback) 
  {
		if (oldEvent != event || oldUpdateCount != Config.updateCount) 
	  	{
	  		console.log("Reset tracking event to "+event.code+" | OLD="+(oldEvent ? oldEvent.code : ""));
	  		if (oldEvent) {
	  			if (oldEvent.stream) 
	  				oldEvent.stream.isStopped=true;
	  			delete oldEvent.trackedParticipants;
	  			delete oldEvent.partLookupByIMEI;
	  		}
	  		oldEvent=event;
	  		oldUpdateCount=Config.updateCount;
	  		if (event != null)
	  		{
	  			//----------------------------------------------------------------------------------------------------------------------------------
	  			prepareEvent(event,true);
	  			console.log(event.trackedParticipants.length+" tracked participants found");
	  			//---------------------------------------------------------------------
	  			if (!onDoneCallback) {
	  				console.log("Starting tracking engine for track "+event.code+" with length "+Utils.formatNumber2(event.TRACK.getTrackLength()/1000.0)+" km. ("+Utils.formatNumber2(event.bikeStartKM)+" + "+Utils.formatNumber2(event.runStartKM-event.bikeStartKM)+" + "+Utils.formatNumber2(event.TRACK.getTrackLength()/1000.0-event.runStartKM)+") km");
	  				event.stream = new StreamData();
	  				event.stream.start(event.TRACK,inRaceChecker,Config.network.pingInterval,doHTTP);
	  			} else {
	  				var stream = new StreamData();
	  		  		stream.getEventData(event,event.TRACK,onDoneCallback);
	  			}
	  		}
	  	}
  }
  //----------------------------------------
  function simulateEvent(event,onDone) 
  {
	  console.log("SIMULATING EVENT "+event.code);
	  prepareEvent(event);
	  Simulator.simulate(event,event.TRACK,onDone);
  }
  
  function recalculateEvent(event,onDone) 
  {
	  if (!CONFIG.__skipParticipantHistoryClear)
		  CONFIG.__skipParticipantHistoryClear=0;
	  CONFIG.__skipParticipantHistoryClear++;
	  console.log("RECALC event "+event.code+" | "+event.startTime+"      "+event.endTime);
	  client.query("DELETE FROM calculated_states where eventId = $1", [event.id], function(err, result) 
	  {
		  console.log("DELETED calculated_states for event = "+event.code);  
		  function tDone() 
		  {
			  console.log("RECALC FOR "+event.code+" | "+event.startTime+"      "+event.endTime+" ||| START RANKING...");
		  	  for (var t=event.startTime.getTime();t<event.endTime.getTime();t+=Config.network.pingInterval*1000) 
		  	  {
		  		  doRanking(t,event);
		  	  }
			  this.__skipParticipantHistoryClear--;
		  }
		  doFetchData(event,function(url,json,onReqDone) 
	      {		 
	  	      if (json.length) 
	  	      {
	  	  		var cc = requestJSON.createClient("http://liverortung.de");
	  	  		var tt = [];
	  	  		for (var i in json) {
	  	  			tt[i]={imei:json[i].imei,from:json[i].from,to:json[i].to};
	  	  			tt[i].toSTR=moment.utc(new Date(tt[i].to)).format("DD.MM.YYYY HH:mm:ss.SS");
	  	  			tt[i].fromSTR=moment.utc(new Date(tt[i].from)).format("DD.MM.YYYY HH:mm:ss.SS");
	  	  		}	  		  	  		
	  	  		function postDone(err, res, body) 
	  	  		{
	  	  			if (err)
	  	  				console.log("Error geting server event data "+err);
	  	  			else { 
	  	  				onReqDone(body);
	  	  				tDone();
	  	  				onDone();
	  	  			}
	  	  		}
	  	  		cc.post(url, json, postDone);
	  	      } else {
	  			  tDone();
	  	    	  onDone();
	  	      }
	      });
	  });

  }
  //----------------------------------------
  function doRanking(ctime,event) 
  {
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
	  	if (DOLOG)
	  		console.log(arr.length+" | GENERATE INTERMEDIATE : "+Utils.formatDateTimeSec(new Date(ctime)));
	  	//console.log(val);
	  	arr.sort(function(a, b){
	  		var a1 = event.trackedParticipants[a].isDiscarded ? 1 : 0;
	  		var b1 = event.trackedParticipants[b].isDiscarded ? 1 : 0;
	  		if (a1 != b1)
	  			return a1-b1;
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
	  		ts.setIsSOS(part.min(ctime,"isSOS"));
	  		ts.setIsDiscarded(part.min(ctime,"isDiscarded"));
	  		ts.setTimestamp(ctime);		
	  		ts.setOverallRank(overAllRank[part.deviceId]);
	  		ts.setGenderRank(genderRank[part.deviceId]);
	  		ts.setGroupRank(groupRank[part.deviceId]);
	  		ts.debugInfo = part.min(ctime,"debugInfo");
	  		//------------
	  		ts.partId=part.id;
	  		ts.eventId=event.id;
	  		ts.imei=part.deviceId;
	  		//------------  		
	  		//console.log("STATE DEBUG INFO : "+JSON.stringify(ts.debugInfo));
	  		addState(event,part.deviceId,ts);
	  	}
	  	var dinfo=[];
	  	for (var i in arr) {
	  		var part = event.trackedParticipants[i];		
	  		dinfo.push(Math.round(part.__elapsed*100*100)/100.0);
	  	}
	  	//console.log(">>>>>>>>> "+JSON.stringify(dinfo));	  
  }
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
  	doRanking(ctime,event);  	
  }
  //-------------------------------------------------------------------------
  // from inclusive , to exclusive
  exports.queryData = function(imei,from,to,onResult) 
  {
  	var event = Config.getCurrentEvent();
  	if (!event) {
  		queryDB(imei,from,to,onResult);
  		return;
  	}
  	var res=[];
  	// local live storage
  	if (from >= event.stateStorage[imei].getMinKey()) 
  	{  	  	
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
  	  				isSOS : state.isSOS,
  	  				isDiscarded : state.isDiscarded,
  	  				debugInfo : state.debugInfo
  	  			});
  	  		}
  	  	}
  	  	res.sort(function(a, b){
  	  		return a.timestamp - b.timestamp;
  	  	});
  		onResult(res);
  	} else {
  		// NOT LOCAL STORAGE POSSIBLE -> DB 
  		queryDB(imei,from,to,onResult);
  	}  	
  }
  //--------------------------------------------------------------------------
  function queryDB(imei,from,to,onResult) {
	  if (!client) {
		  console.log("NO CLIENT in queryDB");
		  onResult([]);
		  return;
	  }
	  client.query('SELECT data FROM calculated_states where t >= $1 AND t < $2 AND imei = $3 ORDER BY t', [from,to,imei], function(err, result) {
			if (err)
  				console.log("Error geting server live data "+err);
			else {
				//console.log("QUERYY DB : "+result.rows.length+" | "+from+" "+to+" | "+imei);
				var arr=[];
				for (var i=0;i<result.rows.length;i++)
					arr.push(result.rows[i].data);
				onResult(arr);
			}
	  });
  }
  //--------------------------------------------------------------------------
});


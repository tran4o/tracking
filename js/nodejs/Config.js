var moment = require('moment');
var fs = require('fs');
var path = require('path');
var xml2js = require('xml2js');
var Utils = require("./../app/Utils");
var deepcopy = require('deepcopy');
//var low = require('lowdb');
//--------------------------------------------------------------------------------------
console.log("\nLoading participants list...");
var ppath = path.join(__dirname, "../../data/participants.json"); 
var data = fs.readFileSync(ppath,{ encoding: 'utf8' });
console.log("Participants data length "+data.length+" bytes");
var json=JSON.parse(data);
var now = (new Date()).getTime();
exports.participants=json.participations;
console.log(json.participations.length+" participants total loaded\n");

var partByID;
exports.updateCount=0;
function onParticipantsChanged() 
{
	partByID = {};
	for (var i in json.participants) {
		var p = json.participants[i];
		var id = p.idParticipant;
		partByID[id]=p;
	}
	for (var i in exports.events) 
	{
		var event = exports.events[i];
		event.parts=[];
		for (var k in event.participants) {
			var p = event.participants[k];
			if (partByID[p]) {
				event.parts.push(partByID[p]);
			}
		}
	} 
	exports.updateCount++;
}

//--------------------------------------------------------------------------------------
console.log("Loading server configuration...");
var data = fs.readFileSync(path.join(__dirname, "../../data/config.json"),{ encoding: 'utf8' });
console.log("Config data length "+data.length+" bytes");
var json=JSON.parse(data);
//------------------------------------------------------------------------------------------
var epath = path.join(__dirname, "../../data/events.json");
data = fs.readFileSync(epath,{ encoding: 'utf8' });
console.log("Events data length "+data.length+" bytes");
var ejson=JSON.parse(data);
var now = (new Date()).getTime();
json.events=ejson;
//------------------------------------------------------------------------------------------
for (var j in json.events) 
{
	var event = json.events[j];
	event.startTime = json.simulation.enabled ? new Date() : new Date(moment(event.startTime, "DD.MM.YYYY HH:mm"));
	event.endTime = json.simulation.enabled ? new Date((new Date().getTime())+60*1000*60*24) : new Date(moment(event.endTime, "DD.MM.YYYY HH:mm"));
	console.log("\nEvent configration ["+Utils.formatDateTime(event.startTime)+"  >  "+Utils.formatDateTime(event.endTime)+"]");
	console.log("Now is "+Utils.formatDateTime(new Date(now)));
	console.log((event.startTime.getTime()-now)/(60.0*1000.0)+" MINUTES TO GO\n");
	if (!event.starts)
		event.starts=[];
	if (!event.participants)
		event.participants=[];	
	for (var i in event.starts) 
	{
		var str = event.starts[i];
		str.startTime = json.simulation.enabled ?  new Date() : moment( moment(event.startTime).format("DD.MM.YYYY")+" "+str.startTime, "DD.MM.YYYY HH:mm").toDate();
		console.log("#START for ["+str.fromStartNo+".."+str.toStartNo+"] @ "+Utils.formatDateTime(str.startTime));
	}
	var pp=[];
	
	if (json.simulation.enabled)
		break;
}
//------------------------------------------------------------------------------------------
for (var i in json)
	exports[i]=json[i];
onParticipantsChanged();
//--------------------------------------------------------------------------------------
exports.getCurrentEvent = function() 
{
	var ctime = (new Date()).getTime();
	for (var i in exports.events) 
	{
		var event = exports.events[i];
		var isTime = (ctime >= event.startTime.getTime() && ctime <= event.endTime.getTime());
		if (isTime)
			return event;
	}
	return null;
}
exports.getCurrentOrNextEvent = function() 
{
	var event = exports.getCurrentEvent();
	if (event != null)
		return event;
	var ctime = (new Date()).getTime();
	var min = null;
	var event = null;
	for (var i in exports.events) 
	{
		var e = exports.events[i];
		var diff = (e.startTime.getTime()-ctime);
		if (diff >= 0 && (min == null || min > diff)) {
			event=e;
			min=diff;
		}
	}
	return event;
}
//--------------------------------------------------------------------------------------
exports.getStartTimeFromStartPos = function(startPos) 
{
	var event = getCurrentEvent();
	if (!event)
		return 0;
	
	for (var i in event.starts) 
	{
		if (startPos >= event.starts[i].fromStartNo && startPos <= event.starts[i].toStartNo) {
			return event.starts[i].startTime.getTime();
		}
	}
	return 0;
}
//--------------------------------------------------------------------------------------
var data = fs.readFileSync(path.join(__dirname, "../../data/aliases.xml"),{ encoding: 'utf8' });
var aliases={};
xml2js.parseString(data, function (err, result) {
	if (err)
		console.log("ERROR parsing aliases.xml");
	else {
		var devs = result["entity-engine-xml"]["M2MDevice"];
		for (var i in devs) 
		{
			var dev = devs[i]["$"];
			aliases[dev.m2mDeviceId]=dev.imeiNumber;
		}
	}
});
//--------------------------------------------------------------------------------------
var apath = path.join(__dirname, "../../data/assignments.json");
var data = "{}";
if (fs.existsSync(apath))
	data=fs.readFileSync(apath,{ encoding: 'utf8' });
console.log("Assignments data length "+data.length+" bytes");
var assignments={};
try {
	assignments=JSON.parse(data);
} catch(e) {
	console.log("ERROR parsing json (assignments) : "+e)
}
exports.assignments=assignments;
function mapIMEI(imei) {
	if (aliases[imei])
		return aliases[imei];
	return imei;
}

function unmapIMEI(imei) 
{	
	for (var i in aliases) {
		if (aliases[i] == imei)
			return i;
	}
	return imei;
}

exports.aliases=aliases;
exports.mapIMEI=mapIMEI;
exports.unmapIMEI=unmapIMEI;
function assignIMEI(mikaId,imei) 
{
	if (!imei)
		delete assignments[mikaId];
	else
		assignments[mikaId]=imei;
	fs.writeFileSync(apath, JSON.stringify(assignments, null, 4)); 
}
function lookupIMEI(id) {
	if (assignments[id] && assignments[id].length)
		return assignments[id]; 
	return null
}
exports.assignIMEI=assignIMEI;

function saveEvents() 
{
	for (var i in exports.events) 
	{
		var oe = exports.events[i];
		var e = {};
		e.id=oe.id;
		if (oe.bikeStartKM != undefined) 
			e.bikeStartKM=oe.bikeStartKM;
		if (oe.runStartKM != undefined) 
			e.runStartKM=oe.runStartKM;
		if (oe.participants != undefined) 
			e.participants=oe.participants;
		if (oe.trackData)
			e.trackData=oe.trackData;
		if (oe.startTime)
			e.startTime=moment(oe.startTime).format("DD.MM.YYYY HH:mm");
		else
			delete e.startTime;
		if (oe.endTime)
			e.endTime=moment(oe.endTime).format("DD.MM.YYYY HH:mm");
		else
			delete e.endTime;

		e.starts=[];
		if (oe.starts)
		for (var k in oe.starts) 
		{
			var os = oe.starts[k];
			var s = {};
			s.id=os.id;
			s.startTime=moment(os.startTime).format("HH:mm");
			if (os.fromStartNo != undefined) 
				s.fromStartNo=os.fromStartNo;
			if (os.toStartNo != undefined)
				s.toStartNo=os.toStartNo;
			e.starts.push(s);
			console.log("KEY = "+k);
			console.log(JSON.stringify(s, null, 4));
		}
		//console.log(JSON.stringify(e, null, 4));
	}
	//fs.writeFileSync(epath, JSON.stringify(evts, null, 4));
}
function saveParticipants() {
	
}
//-----------------------------------
function deleteParticipant(id) {
	var npart=[];
	var ok=false;
	for (var i in exports.participants) 
	{
		var part = exports.participants[i];
		if (part.idParticipant == id) {
			ok=true;
			continue;
		}
		npart.push(part);
	}
	if (ok) {
		exports.participants=npart;
		onParticipantsChanged();
		saveParticipants();
	}
	return ok;
}
exports.deleteParticipant=deleteParticipant;
function updateParticipant(id,json) 
{	
	function doIt(part) 
	{
		part.idParticipant=id;
		part.firstname=json.firstname;
		part.lastname=json.lastname;
		if (json.birthDate)
			part.birthDate=json.birthDate;
		else
			delete part.birthDate;
		part.nationality=json.nationality;
		part.club=json.club;
		part.sex=json.gender;
		part.startGroup=json.startGroup;
		if (json.startNo == undefined)
			delete part.startNo;
		else
			part.startNo=json.startNo;
		onParticipantsChanged();
		saveParticipants();
		return part;
	}
	for (var i in exports.participants) 
	{
		var part = exports.participants[i];
		if (part.idParticipant == id)  
			return doIt(part);
	}
	var part = doIt({});
	exports.participants.push(part);
	onParticipantsChanged();
	saveParticipants();
	return part;
}
exports.updateParticipant=updateParticipant;
//-----------------------------------
function deleteEvent(id) {
	var nevent=[];
	var ok=false;
	for (var i in exports.events) 
	{
		var event = exports.events[i];
		if (event.id == id) {
			ok=true;
			continue;
		}
		nevent.push(event);
	}
	if (ok) {
		exports.event=nevent;
		exports.updateCount++;
		saveEvents();
	}
	return ok;
}
exports.deleteEvent=deleteEvent;
function updateEvent(id,json) 
{	
	function doIt(event) 
	{
		event.id=id;
		event.trackData=json.track;
		event.startTime=json.startTime;
		event.endTime=json.endTime;
		event.bikeStartKM=json.bikeStartKM;
		event.runStartKM=json.runStartKM;
		exports.updateCount++;
		saveEvents();
		return event;
	}
	for (var i in exports.events) 
	{
		var event = exports.events[i];
		if (event.id == id)  
			return doIt(event);
	}
	var event = doIt({});
	exports.events.push(event);
	exports.updateCount++;
	saveEvents();
	return event;
}
exports.updateEvent=updateEvent;
function deleteStart(event,id) {
	var nstart=[];
	var ok=false;
	for (var i in event.starts) 
	{
		var start = event.starts[i];
		if (start.id == id) {
			ok=true;
			continue;
		}
		nstart.push(start);
	}
	if (ok) {
		event.starts=nstart;
		exports.updateCount++;
		saveEvents();
	}
	return ok;
}
exports.deleteStart=deleteStart;
function updateStart(event,id,json) 
{	
	function doIt(start) 
	{
		start.id=id;
		start.fromStartNo=json.fromStartNo;
		start.toStartNo=json.toStartNo;
		start.startTime=json.startTime;
		exports.updateCount++;
		saveEvents();
		return start;
	}
	for (var i in event.starts) 
	{
		var start = event.starts[i];
		if (start.id == id)  
			return doIt(start);
	}
	var start = doIt({});
	event.starts.push(start);
	exports.updateCount++;
	saveEvents();
	return start;
}
exports.updateStart=updateStart;
//--------------------------------------------------------------------------------------
//assignIMEI("ABC1","123A");
//--------------------------------------------------------------------------------------
console.log("Found "+Object.keys(assignments).length+" assignments\n");
console.log(Object.keys(aliases).length+" aliases read from aliases.xml");

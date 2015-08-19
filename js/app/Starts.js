window.CONFIG=require('./Config');
var Utils=require('./Utils');
for (var e in Utils) 
	window[e]=Utils[e];

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
var params = getSearchParameters();
document.title="Starts for event "+(params.title ? params.title : "");
var eid = params.id;
//---------------------------------------
if (!eid)
	return;
var EDITOR2 = new $.fn.dataTable.Editor( {
	ajax: '../starts/'+eid,
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


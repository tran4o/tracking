//---------------------------------------------------------------------------------------------------------
require('./Track');
require('./Gui');
require('./Participant');
require('./MovingCam');
require('./HotSpot');
require('./BackendStream');
require('./../nodejs/StreamData');
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
var params = getSearchParameters();
//-----------------------------------------------
if (params["debug"] && params["debug"] != "0") {
    console.warn("GOING TO DEBUG MODE...");
    CONFIG.timeouts.animationFrame = 4; // 4 sec
}
if (params["show"] && params["show"] != "0") {
    console.warn("GOING TO SHOW MODE...");
    CONFIG.appearance.debug = 1;
}    
//-----------------------------------------------
if (params["simple"] && params["simple"] != "0") {
    console.warn("GOING TO SIMPLE MODE...");
    CONFIG.settings.noMiddleWare = 1;
    CONFIG.settings.noInterpolation = 1;
}
//-----------------------------------------------
var tableFavorites = null;
var tableParticipants = null;

function showMap() {
    $("#left_pane").addClass('hide');
    $("#map").removeClass('col-sm-6 col-md-8 hidden-xs').addClass('col-sm-12');
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

function isTabVisible(tabId) {
    if ($("#left_pane").hasClass("hide"))
        return false;
    return !($('#' + tabId).hasClass('hide'));
}

function showTab(tabId) {
    showLeftPane();

    $('#tabcont').find('div[role="tabpanel"]').addClass('hide');
    $('#' + tabId).removeClass('hide');

    if (tabId == "participants") {
        initTableParticipants();
    } else if (tabId == "favorites") {
        initTableFavorites();
    }
}

function initTableParticipants() {
    if (!tableParticipants) {
        var arr = PARTICIPANTS;
        var res = [];
        for (var i in arr) {
            var part = arr[i];
            res.push({
                id: part.id,
                follow: part.isFavorite,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age,
                "overall-rank": part.getOverallRank(),
                "gender-rank": part.getGenderRank(),
                "group-rank": part.getGroupRank(),
                "occupation": ""
            });
        }
        tableParticipants = $('#table-participants').DataTable({
            "iDisplayLength": 50,
            "bAutoWidth": false,
            "aaSorting": [[1, 'asc']],
            data: res,
            columns: [
                {
                    //follow
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        var favImgSrc;
                        if (data.follow == 1)
                            favImgSrc = "star_solid.svg";
                        else
                            favImgSrc = "star.svg";
                        return "<img data-id='" + data.id + "' src='img/" + favImgSrc + "' class='table-favorite-add'/>";
                    }
                },

                {data: "name"},
                {data: "overall-rank", className: "dt-body-center"},
                {data: "group-rank", className: "dt-body-center"},
                {data: "gender-rank", className: "dt-body-center"},
                {data: "bib", className: "dt-body-center"},
                {data: "gender", className: "dt-body-center"},
                {
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">' + data.country + '</div><flag-icon key="' + data.country + '" width="42"></flag-icon>';
                    }
                },
                {
                    // age + GROUP
                    data: null,
                    render: function (data, type, row) {
                        return data.age;
                    }
                },
                {data: "occupation", className: "dt-body-center"}
            ],
            tableTools: {
                sRowSelect: "os",
                aButtons: []
            }
        });

        $("#table-participants").on("click", ".table-favorite-add", function() {
            var id = $(this).data('id');
            changeFavorite(id);
        });
    } else {
        $("#table-participants").resize();
    }
}

function initTableFavorites() {
    if (!tableFavorites) {
        var arr = PARTICIPANTS.filter(function (v) {
            return v.isFavorite;
        });
        var res = [];
        for (var i in arr) {
            var part = arr[i];
            res.push({
                id: part.id,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age
            });
        }
        tableFavorites = $('#table-favorites').DataTable({
            "destroy": true,
            "iDisplayLength": 50,
            "bAutoWidth": false,
            "aaSorting": [[1, 'asc']],
            data: res,
            columns: [
                {data: "name"},
                {data: "bib", className: "dt-body-center"},
                {data: "gender", className: "dt-body-center"},
                {
                    className: "dt-body-center",
                    data: null,
                    render: function (data, type, row) {
                        if (!data.country)
                            return "";
                        return '<div class="invisible">' + data.country + '</div><flag-icon key="' + data.country + '" width="42"></flag-icon>';
                    }
                },
                {
                    // age + GROUP
                    data: null,
                    render: function (data, type, row) {
                        return data.age;
                    }
                    , className: "dt-body-right"

                }
            ],
            tableTools: {
                sRowSelect: "os",
                aButtons: []
            }
        });

        $("#table-favorites").on("click", "tbody tr", function() {
            var data = tableFavorites.row( this ).data();
            var id = data.id;
            var part = TRACK.getParticipantById(id);
            if (part) {
                GUI.setSelectedParticipant(part);
            }
        });
    } else {
        $("#table-favorites").resize();
    }
}

function refreshTables() {
    if (tableParticipants) {
        var arr = PARTICIPANTS;
        tableParticipants.clear();
        arr.forEach(function (part) {
            tableParticipants.row.add({
                id: part.id,
                follow: part.isFavorite,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age,
                "overall-rank": part.getOverallRank(),
                "gender-rank": part.getGenderRank(),
                "group-rank": part.getGroupRank(),
                "occupation": ""
            });
        });
        tableParticipants.draw();
    }

    if (tableFavorites) {
        var arr = PARTICIPANTS.filter(function (v) {
            return v.isFavorite;
        });
        tableFavorites.clear();
        arr.forEach(function (part) {
            tableFavorites.row.add({
                id: part.id,
                name: part.code,
                bib: part.startPos,
                gender: part.gender,
                country: part.country,
                ageGroup: part.ageGroup,
                age: part.age
            });
        });
        tableFavorites.draw();
    }
}

function changeFavorite(id) {
    for (var i in TRACK.participants) {
        var p = TRACK.participants[i];
        if (p.id == id) {
            p.isFavorite = !p.isFavorite;
            localStorage.setItem("favorite-" + p.id, p.isFavorite ? "1" : "0");
            refreshTables();
            break;
        }
    }
}

//--------------------------------------------------------------------------
// use this if you want to bypass all the NodeJS dynamic event get
// then set this to a demo JSON file (e.g. "demo_simulation_data_1.json")
//window.isDEMO_SIMULATION = demo_simulation_data_1.json;

window.TRACK = new Track();
window.GUI = new Gui({track: TRACK, isSkipExtent : true, initialZoom : 15});
window.PARTICIPANTS = [];
if (params["show"] && params["show"] != "0") {
    GUI.isDebug=true;
}    
//--------------------------------------------------------------------------
$(document).ready(function () {
    if (Utils.mobileAndTabletCheck())
        $("body").addClass("mobile");

    // Event data loading - realtime or hard simulated
    //--------------------------------------------------------------------------
    var eventDataUrl;
    if (!!window.isDEMO_SIMULATION) {
        // load the demo simulation generator
        var demoSimulation = require('./DemoSimulation');
        // this is the data with the demo participants/cams
        eventDataUrl = "data/" + window.isDEMO_SIMULATION;

        CONFIG.math.displayDelay = 10; // fix this animation display delay time
    } else {
        var baseurl = (window.location.host.indexOf("localhost") == 0 ||
        window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/" : "node/";
        eventDataUrl = baseurl + "event";
    }

    $.getJSON(eventDataUrl).done(function (data) {
        TRACK.setBikeStartKM(data.bikeStartKM);
        TRACK.setRunStartKM(data.runStartKM);
        TRACK.setRoute(data.route);
        CONFIG.times = {begin: data.times.startTime , end: data.times.endTime };
        GUI.init();

        var hasRealFavorites = false;
        function processEntry(pdata, isCam) {
            var part;
            if (isCam)
                part = TRACK.newMovingCam(pdata.id, pdata.deviceId, pdata.code);
            else
                part = TRACK.newParticipant(pdata.id, pdata.deviceId, pdata.code);
            part.setColor(pdata.color);
            part.setAgeGroup(pdata.ageGroup);
            part.setAge(pdata.age);
            part.setCountry(pdata.country);
            part.setStartPos(pdata.startPos);
            part.setGender(pdata.gender);
            part.setIcon(pdata.icon);
            part.setImage(pdata.image);
            if (isCam || localStorage.getItem("favorite-" + part.id) == 1)
                part.setIsFavorite(true);
            if (!isCam) {
                PARTICIPANTS.push(part);

                // we just want to know if there's any favorite at all
                if (!hasRealFavorites && part.getIsFavorite()) {
                    hasRealFavorites = true;
                }
            }

            // if this is a demo simulation then start it for each single favourite-participant or cam
            if (!!window.isDEMO_SIMULATION) {
                if (part.getIsFavorite()) {
                    demoSimulation.simulateParticipant(part);
                }
            }
        }

        for (var i in data.participants)
            processEntry(data.participants[i], false);
        for (var i in data.cams)
            processEntry(data.cams[i], true);

        // if this is not a demo simulation start listening for the realtime pings
        if (!window.isDEMO_SIMULATION) {
            if (CONFIG.settings.noMiddleWare) {
                function doHTTP(url, json, onReqDone) {
                    if (json.length) {
                        $.ajax({
                            type: "POST",
                            url: url,
                            data: JSON.stringify(json),
                            contentType: "application/json; charset=utf-8",
                            dataType: "json",
                            success: function (data) {
                                onReqDone(data);
                            },
                            failure: function (errMsg) {
                                console.error("ERROR get data from backend " + errMsg)
                            }
                        });
                    }
                }

                var stream = new StreamData();
                stream.start(TRACK, function () {
                    return true;
                }, 10, doHTTP); // 10 sec ping int.
            } else {
                // NORMAL CASE
                var stream = new BackendStream();
                stream.start(TRACK);
            }
        }

        // add all the static HotSpots
        var dynamicTrackHotspots = [];
        for (var k = 0; k < HOTSPOTS.length; k++) {
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

        // if there are no favorites then open the All Participants tab first
        if (!hasRealFavorites) {
            showTab("participants");
            // show a notification
            $.bootstrapGrowl("Select your favourites by pressing the stars", {
                ele: '#participants', // which element to append to
                offset: {from: 'bottom', amount: 20}, // 'top', or 'bottom'
                align: 'center' // ('left', 'right', or 'center')
            });
        }
    }).fail(function () {
        console.error("Error get event configuration from backend!");
    });

    //--------------------------------------------------------------------------

    $("#button_swim, #button_bike, #button_run").
        css("background-color", function() {
            return CONFIG.appearance["trackColor" + $(this).data("track")];
        }).
        click(function () {
            var track = $(this).data("track");
            $(this).toggleClass("inactive");
            GUI["isShow" + track] = !$(this).hasClass("inactive");
            GUI.redraw();
        });

    $("#button_rank, #button_participants, #button_favorites").click(function () {
        var openTabId = $(this).data("open");
        if (isTabVisible(openTabId))
            showMap();
        else
            showTab(openTabId);
    });

    $("#tabcont").find(".close").click(function () {
        showMap();
    });

    $("#link_partners, #link_legalNotice, #button_liveStream").click(function () {
        var $toClose = $("._contVisible");
        var $toOpen = $("#" + $(this).data("open"));
        var isLiveStreamClose = $toClose.is("#liveStream");
        var isLiveStreamOpen = $toOpen.is("#liveStream");

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


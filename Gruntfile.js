module.exports = function (grunt) {
    // simple tasks not requiring any grunt-plugin
    grunt.registerTask("log-build-start", function() {
        console.log("Start building...");
    });
    grunt.registerTask("log-build-end", function() {
        console.log("Done building");
    });

    // define all the task that require a grunt-plugin
    grunt.initConfig({
        exec: {
            browserify_index: {
                command: 'browserify js\\app\\Index.js --debug >index.js'
            },

            browserify_admin: {
                command: 'browserify js\\app\\Admin.js --debug >js\\nodejs\\admin\\admin.js'
            },

            browserify_start: {
                command: 'browserify js\\app\\Starts.js --debug >js\\nodejs\\admin\\starts.js'
            }
        },

        wget: {
            raceParticipants: {
                files: {
                    //'data/participants.json': "http://portal.mikatiming.de/ah/rest/appapi/meetinginfo/race/9999990FEBE3BA0000000321/participations?apiKey=sast-152fed7f&pageMaxCount=9999"
                    'data/participants.json': 'http://portal.mikatiming.de/ah/rest/appapi/meetinginfo/race/9999990FEBE3BA0000000322/participations?apiKey=sast-152fed7f&pageMaxCount=9999'
                }
            },
            raceStart: {
                files: {
                    'data/.notused': "http://localhost:3000/raceStart/353816058291727"
                }
            },
            raceClear: {
                files: {
                    'data/.notused': "http://connectedlifestyle.dtrd.de/triathlon/rest/clearRace"
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-wget');

    // this will be the default/normal grunt task
    grunt.registerTask("default", ["log-build-start",

        "exec:browserify_index", "exec:browserify_admin", "exec:browserify_start",

        "log-build-end"]);
};
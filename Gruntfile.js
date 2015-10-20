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
                command: 'browserify js/app/Index.js --debug >build/index.js'
            },

            browserify_live: {
                command: 'browserify js/app/Live.js --debug >build/live.js'
            },

            browserify_admin: {
                command: 'browserify js/app/Admin.js --debug >build/admin.js'
            },

            browserify_event: {
                command: 'browserify js/app/Event.js --debug >build/event.js'
            },

            browserify_start: {
                command: 'browserify js/app/Starts.js --debug >build/starts.js'
            }
        },
    });

    grunt.loadNpmTasks('grunt-exec');

    // this will be the default/normal grunt task
    grunt.registerTask("default", ["log-build-start",

                                   "exec:browserify_index", "exec:browserify_live", "exec:browserify_admin", "exec:browserify_start","exec:browserify_event",

        "log-build-end"]);
};
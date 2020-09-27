'use strict';
exports.default = void 0;
var _nc = require('@tahini/nc');
var _default = async ()=>{
    const { SHOULD_PUBLISH_NPM , SHOULD_PUBLISH_DOCKER , DOCKER_ORGANIZATION_NAME , DOCKER_REGISTRY , NPM_REGISTRY , NPM_EMAIL , NPM_USERNAME , NPM_TOKEN , DOCKER_HUB_USERNAME , DOCKER_HUB_TOKEN , REDIS_ENDPOINT , REDIS_PASSWORD , TEST_SCRIPT_NAME  } = process.env;
    const fullImageNameCacheKey = ({ packageHash  })=>`full_image_name_of_artifact_hash-${packageHash}`
    ;
    const jsonReportCacheKey = ({ flowId , stepId  })=>`json-report-cache-key-${flowId}-${stepId}`
    ;
    const jsonReportToString = ({ jsonReport  })=>JSON.stringify(jsonReport)
    ;
    const stringToJsonReport = ({ jsonReportAsString  })=>JSON.parse(jsonReportAsString)
    ;
    const logger = _nc.winstonLogger({
        customLogLevel: _nc.LogLevel.verbose,
        disabled: false,
        logFilePath: './nc.log'
    });
    const cache = _nc.redisWithNodeCache({
        redis: {
            redisServer: REDIS_ENDPOINT,
            auth: {
                password: REDIS_PASSWORD
            }
        }
    });
    const steps = [
        _nc.install(),
        _nc.validatePackages(),
        _nc.lint(),
        _nc.build(),
        _nc.test({
            testScriptName: TEST_SCRIPT_NAME
        }),
        _nc.npmPublish({
            shouldPublish: Boolean(SHOULD_PUBLISH_NPM),
            npmScopeAccess: _nc.NpmScopeAccess.public,
            registry: NPM_REGISTRY,
            publishAuth: {
                email: NPM_EMAIL,
                username: NPM_USERNAME,
                token: NPM_TOKEN
            }
        }),
        _nc.dockerPublish({
            shouldPublish: Boolean(SHOULD_PUBLISH_DOCKER),
            dockerOrganizationName: DOCKER_ORGANIZATION_NAME,
            registry: DOCKER_REGISTRY,
            registryAuth: {
                username: DOCKER_HUB_USERNAME,
                token: DOCKER_HUB_TOKEN
            },
            fullImageNameCacheKey
        }),
        _nc.jsonReport({
            jsonReportCacheKey,
            jsonReportToString
        }),
        _nc.cliTableReport({
            jsonReportCacheKey,
            stringToJsonReport
        }), 
    ];
    return {
        steps,
        cache,
        logger
    };
};
exports.default = _default;


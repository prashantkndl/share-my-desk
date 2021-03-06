"use strict";

const bcrypt = require("bcrypt");
const validator = require("email-validator");
const { Entropy } = require("entropy-string");
const logger = require("../lib/logger");
const utils = require("../lib/utils");

const entropy = new Entropy({charset: "1234567890ABCDEF"});
const orgDomain = utils.getConfig("ORG_EMAIL_DOMAIN", "example.com");
const bcryptCost = utils.getConfig("BCRYPT_COST", 11);

const SECRET_EXPIRES_IN = 2 * 3600 * 1000; // 2 hours
/**
 * Check if the email is valid
 * @param {String} email
 * @return {Boolean}
 */
const isEmailValid = (email) => {
    // Simple email test
    if (!validator.validate(email)) {
        return false;
    }
    // Check organization domain only
    return email.split("@",2)[1] === orgDomain;
};

const generateSecret = (cb) => {
    const secret = entropy.string().substring(0,6); // Get 6 char secret with high entropy
    bcrypt.hash(secret, bcryptCost, function(err, hash) {
        cb({ secret: secret, bcrypt: hash });
    });

};
/**
 * Creates an authService instance
 * @param {User} userModel db model to inject for database connectivity
 */
exports.authService = (userModel) => { 

    // If no model was injected, use default
    if (!userModel) {
        userModel = require("../models/User");
    }
    const instance = {};

    /**
     * Sign up for the API
     * Generates a secret key used to activate the user
     * 
     * @param {String} email
     * @param {String} name
     * @param {Function} cb (err, response)
     */
    instance.signUp = (email, name, cb) => {
        if (!isEmailValid(email)) {
            return cb("INVALID_EMAIL");
        }
        // test if email exists
        userModel.findOne({ email: email }, (err, matchedUser) => {
            if (err) {
                return cb("DATABASE_ERROR");
            }

            // Generate secret
            generateSecret((value) => {
                const user = utils.isNull(matchedUser) ? userModel({email: email}) : matchedUser;
                user.name = name;
                user.accountInfo = {
                    secret: value.bcrypt,
                    secretExpires: new Date(Date.now() + SECRET_EXPIRES_IN).toISOString()
                };
                user.save((err) => {
                    if (err) {
                        return cb("DATABASE_ERROR");
                    }
                    cb(null, {secret: value.secret});
                });
            });
        });
    };

    /**
     * Login with the given credentials.
     * Generates API token after verification
     * 
     * @param {String} email
     * @param {String} secret
     * @param {Function} cb(error, response)
     */
    instance.login = (email, secret, cb) => {
        if (!isEmailValid(email)) {
            logger.warn(`Invalid email login attempt denied. Email: ${email}`);
            return cb("EMAIL_UNKNOWN");
        }
        userModel.findOne({ email: email }, (err, matchedUser) => {
            if (err) {
                return cb("DATABASE_ERROR");
            }
            if (utils.isNull(matchedUser)) {
                logger.warn(`Unknown email login attempt denied. Email: ${email}`);
                return cb("EMAIL_UNKNOWN");
            }
            // Email match was found, check the secret
            if (utils.propertyIsNull(matchedUser, "accountInfo")) {
                logger.warn(`Unknown error attempt denied. Email: ${email}`);
                return cb("UNKNOWN_ERROR"); // mandatory field not found
            }
            const secretExpires = matchedUser.accountInfo.secretExpires;
            if (utils.isNull(secretExpires) || Date.now() > secretExpires) {
                logger.warn(`Login attempt denied. Secret expired. Email: ${email}`);
                return cb("SECRET_EXPIRED");
            }

            bcrypt.compare(secret, matchedUser.accountInfo.secret, (err, matched) => {
                if (err || matched == false) {
                    logger.warn(`Login attempt denied. Incorrect secret. Email: ${email}`);
                    return cb("SECRET_INCORRECT");
                }

                // Generate API token
                const token = "Y0uR_10Gln_70k3N";

                // Invalidate the login and save api key
                matchedUser.apiKeys.push(token);
                matchedUser.accountInfo = null;
                matchedUser.save();
                logger.info(`Successful login. Email: ${email}`);
                return cb(null, {token: token});
            });
        });
    };

    return instance;
};

// Exporting for testability
exports.isEmailValid = isEmailValid;
exports.generateSecret = generateSecret;
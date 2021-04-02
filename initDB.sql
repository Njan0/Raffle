CREATE DATABASE IF NOT EXISTS raffle;
USE raffle;

CREATE TABLE raffles (
    id BINARY(16) PRIMARY KEY,
    name VARCHAR(255),
    password VARCHAR(255),
    status ENUM ('Open','Closed') DEFAULT 'Open',
    result VARCHAR(255)
);

CREATE TABLE tickets (
    raffleID BINARY(16),
    content VARCHAR(255),
    owner VARCHAR(40),
    FOREIGN KEY (raffleID) REFERENCES raffles(id),
    PRIMARY KEY (raffleID, owner)
);
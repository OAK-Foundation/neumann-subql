# Neumann Network & Subquery 

A SubQuery package defines which data The SubQuery will index from the Substrate blockchain, and how it will store it. 

You can find the another Neumann dictionary in [this link](https://explorer.subquery.network/subquery/subquery/neumann-dictionary)

## Preparation

#### Environment

- [Typescript](https://www.typescriptlang.org/) are required to compile project and define types.  

- Both SubQuery CLI and generated Project have dependencies and require [Node](https://nodejs.org/en/).
     

#### Install the SubQuery CLI

Install SubQuery CLI globally on your terminal by using NPM:

```
npm install -g @subql/cli
```

Run help to see available commands and usage provide by CLI
```
subql help
```

## Install package deps
```
    yarn install
```

## Configure your project

In the starter package, we have provided a simple example of project configuration. You will be mainly working on the following files:

- The Manifest in `project.yaml`
- The GraphQL Schema in `schema.graphql`
- The Mapping functions in `src/mappings/` directory

For more information on how to write the SubQuery, 
check out our doc section on [Define the SubQuery](https://doc.subquery.network/define_a_subquery.html) 

#### Code generation

In order to index your SubQuery project, it is mandatory to build your project first.
Run this command under the project directory.

````
yarn codegen
````

## Build the project

In order to deploy your SubQuery project to our hosted service, it is mandatory to pack your configuration before upload.
Run pack command from root directory of your project will automatically generate a `your-project-name.tgz` file.

```
yarn build
```

## Indexing and Query

#### Run required systems in docker

Make sure your docker is running first.

Under the project directory run following command:

```
docker-compose pull && docker-compose up
```
#### Query the project

Open your browser and head to `http://localhost:3000`.

Finally, you should see a GraphQL playground is showing in the explorer and the schemas that ready to query.

#### Example: Account Snapshots

````graphql
query {
    accountSnapshots (first: 5) {
        nodes {
            id
            accountId
            snapshotAtBlock
            freeBalance
        }
    }
    accounts (first: 5) {
        nodes {
            id
            freeBalance
            reserveBalance
            totalBalance
        }
    }
}
````
#### Example: Automation task list

```graphql
query {
  extrinsics(filter: { 
    timestamp: { greaterThanOrEqualTo: <start_timestamp>, lessThanOrEqualTo: <end_timestamp> },
    method: { in: ["scheduleNotifyTask", "scheduleNativeTaskTransfer"] },
    success: { equalTo: true }
  }) {
    nodes {
      timestamp blockHeight method args
    }
  }
}
```

#### Example: Automation execution

```graphql
query {
  events(filter: { 
    timestamp: { greaterThanOrEqualTo: <start_timestamp>, lessThanOrEqualTo: <end_timestamp> },
    method: { in: ["Notify", "SuccesfullyTransferredFunds"] }
  }) {
    nodes {
      timestamp blockHeight method data
    }
  }
}
```

# Local development